/**
 * TankageEngine - Calculates tank usage (consumption and additions)
 * 
 * Filtering approach:
 * - Time filter: Only process changes >= 2 minutes apart (filters rapid sensor noise)
 * - Addition requirements: 
 *   - Small tanks: >= 1 gallon increase over >= 5 minutes
 *   - Large tanks: >= 5 gallon increase over >= 5 minutes
 * - Consumption: No quantity threshold, just time filter
 */

const MIN_TIME_BETWEEN_POINTS_MS = 2 * 60 * 1000;  // 2 minutes
const ADDITION_MIN_DURATION_MS = 5 * 60 * 1000;     // 5 minutes
const SMALL_TANK_ADDITION_GAL = 1.0;
const LARGE_TANK_ADDITION_GAL = 5.0;
const M3_TO_GAL = 264.172;
const GAL_TO_M3 = 0.00378541;

// Smoothing window to filter sensor noise
const SMOOTHING_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours

// Large refill detection - jumps this big skip smoothing and get counted directly
const LARGE_REFILL_THRESHOLD_GAL = 10.0; // 10 gallon jump = obvious refill
const LARGE_REFILL_THRESHOLD_M3 = LARGE_REFILL_THRESHOLD_GAL * GAL_TO_M3;

function TankageEngine(app, influxClient, options) {
  this.app = app;
  this.influxClient = influxClient;
  this.options = options;
  this.cache = new Map();
  this.cacheEnabled = options.reporting?.cacheResults !== false;
}

TankageEngine.prototype.calculateAll = async function() {
  this.app.debug('TankageEngine: Calculating usage for all tanks');
  
  const tankageItems = (this.options.tankage || [])
    .filter(item => item.enabled !== false);
  
  const promises = tankageItems.map(item => this.calculateForItem(item));
  await Promise.all(promises);
};

TankageEngine.prototype.calculateForItem = async function(item) {
  const { path } = item;
  
  this.app.debug(`TankageEngine: Calculating usage for ${path}`);
  
  const periods = item.periods || [
    { range: '24h', aggregation: '15m' },
    { range: '7d', aggregation: '1h' }
  ];
  
  const itemData = {
    path: path,
    name: item.name || path,
    unit: this.getUnit(item),
    capacity: item.capacity,
    periods: {}
  };

  for (const period of periods) {
    try {
      const usage = await this.calculateUsageForPeriod(item, period);
      itemData.periods[period.range] = usage;
    } catch (err) {
      this.app.debug(`TankageEngine: Error calculating ${period.range} usage for ${path}: ${err.message}`);
      itemData.periods[period.range] = { 
        insufficientData: true,
        reason: `Error: ${err.message}` 
      };
    }
  }

  if (this.cacheEnabled) {
    this.cache.set(path, {
      timestamp: Date.now(),
      data: itemData
    });
  }
};

TankageEngine.prototype.calculateUsageForPeriod = async function(item, period) {
  const { path } = item;
  const { range, aggregation } = period;
  
  this.app.debug(`TankageEngine: Calculating ${range} for ${path} (aggregation: ${aggregation || 'auto'})`);
  
  const rangeHours = this.parseTimeRange(range);
  
  let uniquePeriods, expectedPeriods, periodType;
  if (rangeHours >= 24) {
    const days = Math.ceil(rangeHours / 24);
    periodType = 'days';
    uniquePeriods = days;
    expectedPeriods = Math.max(1, Math.floor(days * 0.7));
  } else {
    periodType = 'hours';
    uniquePeriods = Math.ceil(rangeHours);
    expectedPeriods = Math.max(1, Math.floor(rangeHours * 0.7));
  }
  
  const aggregationWindow = aggregation || this.getAutoAggregation(rangeHours);
  const rangeParam = `-${range}`;
  
  let dataPoints;
  try {
    dataPoints = await this.influxClient.queryPath(
      path,
      rangeParam,
      aggregationWindow
    );
  } catch (err) {
    this.app.debug(`TankageEngine: InfluxDB query failed for ${path}: ${err.message}`);
    return {
      insufficientData: true,
      reason: 'Database query failed'
    };
  }
  
  if (!dataPoints || dataPoints.length < 2) {
    return {
      insufficientData: true,
      reason: 'Not enough data points'
    };
  }
  
  const firstTime = new Date(dataPoints[0].timestamp);
  const lastTime = new Date(dataPoints[dataPoints.length - 1].timestamp);
  
  const coveredHours = (lastTime - firstTime) / (1000 * 60 * 60);
  const coveragePercent = (coveredHours / rangeHours) * 100;
  
  if (coveragePercent < 70) {
    return {
      insufficientData: true,
      reason: `Only ${coveragePercent.toFixed(0)}% coverage (need 70%)`
    };
  }
  
  const usage = this.processDataPoints(dataPoints, item);
  
  return usage;
};

TankageEngine.prototype.processDataPoints = function(dataPoints, item) {
  const { path } = item;
  
  // Determine addition threshold based on tank size
  const isLargeTank = item.largeTank || false;
  const additionThresholdGal = isLargeTank ? LARGE_TANK_ADDITION_GAL : SMALL_TANK_ADDITION_GAL;
  const additionThresholdM3 = additionThresholdGal * GAL_TO_M3;
  
  this.app.debug(`TankageEngine: ${path} - Processing ${dataPoints.length} points, Tank type: ${isLargeTank ? 'large' : 'small'} (${additionThresholdGal} gal threshold)`);
  
  // Step 1: Detect large refills in raw data (>10 gal jumps)
  const largeRefillIndices = new Set();
  
  for (let i = 1; i < dataPoints.length; i++) {
    const prevPoint = dataPoints[i - 1];
    const currPoint = dataPoints[i];
    const change = currPoint.value - prevPoint.value;
    
    // If increase is >= 10 gallons, mark as large refill
    if (change >= LARGE_REFILL_THRESHOLD_M3) {
      largeRefillIndices.add(i);
      this.app.debug(`TankageEngine: ${path} - Large refill detected: ${(change * M3_TO_GAL).toFixed(2)} gal at index ${i}, preserving from smoothing`);
    }
  }
  
  // Step 2: Apply 6-hour moving average to smooth sensor noise (except large refills)
  const smoothedPoints = [];
  
  for (let i = 0; i < dataPoints.length; i++) {
    const currentPoint = dataPoints[i];
    
    // If this point is part of a large refill, use raw value and reset smoothing baseline
    if (largeRefillIndices.has(i)) {
      smoothedPoints.push({
        timestamp: currentPoint.timestamp,
        value: currentPoint.value
      });
      // After a large refill, subsequent points should start smoothing from this new baseline
      // This is automatically handled by the moving window looking back
      continue;
    }
    
    const windowStart = currentPoint.timestamp - SMOOTHING_WINDOW_MS;
    
    // Collect all points within the 6-hour window
    // But only start from the most recent large refill if one exists
    let startIndex = 0;
    for (let k = i; k >= 0; k--) {
      if (largeRefillIndices.has(k)) {
        startIndex = k; // Start smoothing from the refill point, not before it
        break;
      }
    }
    
    const windowPoints = [];
    for (let j = startIndex; j <= i; j++) {
      if (dataPoints[j].timestamp >= windowStart) {
        windowPoints.push(dataPoints[j]);
      }
    }
    
    // Calculate average value
    const avgValue = windowPoints.reduce((sum, p) => sum + p.value, 0) / windowPoints.length;
    
    smoothedPoints.push({
      timestamp: currentPoint.timestamp,
      value: avgValue
    });
  }
  
  // Step 3: Calculate consumption and additions from smoothed data
  let totalConsumed = 0;
  let totalAdded = 0;
  let lastTrackedPoint = smoothedPoints[0];
  
  for (let i = 1; i < smoothedPoints.length; i++) {
    const prevPoint = lastTrackedPoint;
    const currPoint = smoothedPoints[i];
    const timeDiffMs = currPoint.timestamp - prevPoint.timestamp;
    
    // Only process points that are at least 2 minutes apart
    if (timeDiffMs < MIN_TIME_BETWEEN_POINTS_MS) {
      continue;
    }
    
    const changeM3 = currPoint.value - prevPoint.value;
    
    if (changeM3 > 0) {
      // Tank increased - check if it meets addition criteria
      const meetsQuantity = changeM3 >= additionThresholdM3;
      const meetsDuration = timeDiffMs >= ADDITION_MIN_DURATION_MS;
      
      if (meetsQuantity && meetsDuration) {
        totalAdded += changeM3;
      }
      
    } else if (changeM3 < 0) {
      // Tank decreased - consumption
      totalConsumed += Math.abs(changeM3);
    }
    
    lastTrackedPoint = currPoint;
  }
  
  this.app.debug(`TankageEngine: ${path} - Consumed: ${(totalConsumed * M3_TO_GAL).toFixed(2)} gal, Added: ${(totalAdded * M3_TO_GAL).toFixed(2)} gal`);
  
  return {
    consumed: totalConsumed,
    added: totalAdded
  };
};

TankageEngine.prototype.calculateTankageFromData = function(dataPoints, isLargeTank) {
  if (!dataPoints || dataPoints.length < 2) {
    return { consumed: 0, added: 0 };
  }

  const additionThresholdGal = isLargeTank ? LARGE_TANK_ADDITION_GAL : SMALL_TANK_ADDITION_GAL;
  const additionThresholdM3 = additionThresholdGal * GAL_TO_M3;
  
  // Step 1: Detect large refills in raw data
  const largeRefillIndices = new Set();
  
  for (let i = 1; i < dataPoints.length; i++) {
    const prevPoint = dataPoints[i - 1];
    const currPoint = dataPoints[i];
    const change = currPoint.value - prevPoint.value;
    
    if (change >= LARGE_REFILL_THRESHOLD_M3) {
      largeRefillIndices.add(i);
    }
  }
  
  // Step 2: Apply 6-hour moving average smoothing (except large refills)
  const smoothedPoints = [];
  
  for (let i = 0; i < dataPoints.length; i++) {
    const currentPoint = dataPoints[i];
    
    // Preserve raw value for large refills
    if (largeRefillIndices.has(i)) {
      smoothedPoints.push({
        timestamp: currentPoint.timestamp,
        value: currentPoint.value
      });
      continue;
    }
    
    const windowStart = currentPoint.timestamp - SMOOTHING_WINDOW_MS;
    
    // Find most recent large refill to use as baseline
    let startIndex = 0;
    for (let k = i; k >= 0; k--) {
      if (largeRefillIndices.has(k)) {
        startIndex = k;
        break;
      }
    }
    
    const windowPoints = [];
    for (let j = startIndex; j <= i; j++) {
      if (dataPoints[j].timestamp >= windowStart) {
        windowPoints.push(dataPoints[j]);
      }
    }
    
    const avgValue = windowPoints.reduce((sum, p) => sum + p.value, 0) / windowPoints.length;
    
    smoothedPoints.push({
      timestamp: currentPoint.timestamp,
      value: avgValue
    });
  }
  
  // Step 3: Calculate from smoothed data
  let totalConsumed = 0;
  let totalAdded = 0;
  let lastTrackedPoint = smoothedPoints[0];
  
  for (let i = 1; i < smoothedPoints.length; i++) {
    const prevPoint = lastTrackedPoint;
    const currPoint = smoothedPoints[i];
    const timeDiffMs = currPoint.timestamp - prevPoint.timestamp;
    
    if (timeDiffMs < MIN_TIME_BETWEEN_POINTS_MS) {
      continue;
    }
    
    const changeM3 = currPoint.value - prevPoint.value;
    
    if (changeM3 > 0) {
      if (changeM3 >= additionThresholdM3 && timeDiffMs >= ADDITION_MIN_DURATION_MS) {
        totalAdded += changeM3;
      }
    } else if (changeM3 < 0) {
      totalConsumed += Math.abs(changeM3);
    }
    
    lastTrackedPoint = currPoint;
  }
  
  return {
    consumed: totalConsumed,
    added: totalAdded
  };
};

TankageEngine.prototype.parseTimeRange = function(range) {
  const match = range.match(/^(\d+)([smhd])$/);
  if (!match) return 1;
  
  const value = parseInt(match[1]);
  const unit = match[2];
  
  switch (unit) {
    case 's': return value / 3600;
    case 'm': return value / 60;
    case 'h': return value;
    case 'd': return value * 24;
    default: return 1;
  }
};

TankageEngine.prototype.getAutoAggregation = function(rangeHours) {
  if (rangeHours <= 1) return '1m';
  if (rangeHours <= 6) return '5m';
  if (rangeHours <= 24) return '15m';
  if (rangeHours <= 168) return '1h';
  return '4h';
};

TankageEngine.prototype.getUsageData = function() {
  const items = {};
  
  this.cache.forEach((cached, path) => {
    items[path] = cached.data;
  });
  
  return items;
};

TankageEngine.prototype.getUsageForPath = function(path) {
  const cached = this.cache.get(path);
  return cached ? cached.data : null;
};

TankageEngine.prototype.getUnit = function(item) {
  if (item.unit) return item.unit;
  
  const path = item.path.toLowerCase();
  
  if (path.includes('currentlevel')) return 'ratio';
  if (path.startsWith('tanks.') && (path.includes('remaining') || path.includes('currentvolume'))) return 'm3';
  
  return 'unknown';
};

TankageEngine.prototype.stop = function() {
  this.cache.clear();
};

module.exports = TankageEngine;