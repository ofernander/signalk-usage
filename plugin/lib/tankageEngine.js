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
const M3_TO_GAL = 264.172;
const GAL_TO_M3 = 0.00378541;

// Consumption calculation - different smoothing for short vs long periods
const SHORT_PERIOD_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const SHORT_PERIOD_SMOOTHING_PERCENT = 0.40; // 40% for periods ≤ 24 hours
const LONG_PERIOD_SMOOTHING_PERCENT = 0.35; // 35% for periods > 24 hours

// Addition calculation - light smoothing to preserve refills
const ADDITION_SMOOTHING_MS = 1 * 60 * 60 * 1000; // 1 hour (fixed)
const SMALL_TANK_ADDITION_GAL = 1.0;
const LARGE_TANK_ADDITION_GAL = 5.0;
const ADDITION_MIN_DURATION_MS = 2 * 60 * 1000; // 5 minutes

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
  
  // Calculate consumption smoothing window based on data range
  const dataRangeMs = dataPoints[dataPoints.length - 1].timestamp - dataPoints[0].timestamp;
  const smoothingPercent = dataRangeMs <= SHORT_PERIOD_THRESHOLD_MS 
    ? SHORT_PERIOD_SMOOTHING_PERCENT 
    : LONG_PERIOD_SMOOTHING_PERCENT;
  const consumptionSmoothingMs = dataRangeMs * smoothingPercent;
  
  this.app.debug(`TankageEngine: ${path} - Processing ${dataPoints.length} points, Tank type: ${isLargeTank ? 'large' : 'small'}, Consumption smoothing: ${(consumptionSmoothingMs / 3600000).toFixed(1)} hours (${(smoothingPercent * 100).toFixed(0)}% of ${(dataRangeMs / 3600000).toFixed(1)} hour range)`);
  
  // CONSUMPTION CALCULATION - Dual smoothing (40% for ≤24h, 35% for >24h) to filter dips
  const consumptionSmoothed = [];
  for (let i = 0; i < dataPoints.length; i++) {
    const currentPoint = dataPoints[i];
    const windowStart = currentPoint.timestamp - consumptionSmoothingMs;
    
    const windowPoints = [];
    for (let j = 0; j <= i; j++) {
      if (dataPoints[j].timestamp >= windowStart) {
        windowPoints.push(dataPoints[j]);
      }
    }
    
    const avgValue = windowPoints.reduce((sum, p) => sum + p.value, 0) / windowPoints.length;
    consumptionSmoothed.push({
      timestamp: currentPoint.timestamp,
      value: avgValue
    });
  }
  
  // Calculate consumption from heavily smoothed data
  let totalConsumed = 0;
  let lastConsumptionPoint = consumptionSmoothed[0];
  
  for (let i = 1; i < consumptionSmoothed.length; i++) {
    const prevPoint = lastConsumptionPoint;
    const currPoint = consumptionSmoothed[i];
    const timeDiffMs = currPoint.timestamp - prevPoint.timestamp;
    
    if (timeDiffMs < MIN_TIME_BETWEEN_POINTS_MS) {
      continue;
    }
    
    const changeM3 = currPoint.value - prevPoint.value;
    
    // Only count decreases
    if (changeM3 < 0) {
      totalConsumed += Math.abs(changeM3);
    }
    
    lastConsumptionPoint = currPoint;
  }
  
  // ADDITION CALCULATION - Light smoothing (1 hour) to preserve refills
  const additionSmoothed = [];
  for (let i = 0; i < dataPoints.length; i++) {
    const currentPoint = dataPoints[i];
    const windowStart = currentPoint.timestamp - ADDITION_SMOOTHING_MS;
    
    const windowPoints = [];
    for (let j = 0; j <= i; j++) {
      if (dataPoints[j].timestamp >= windowStart) {
        windowPoints.push(dataPoints[j]);
      }
    }
    
    const avgValue = windowPoints.reduce((sum, p) => sum + p.value, 0) / windowPoints.length;
    additionSmoothed.push({
      timestamp: currentPoint.timestamp,
      value: avgValue
    });
  }
  
  // Calculate additions from lightly smoothed data
  let totalAdded = 0;
  let lastAdditionPoint = additionSmoothed[0];
  
  for (let i = 1; i < additionSmoothed.length; i++) {
    const prevPoint = lastAdditionPoint;
    const currPoint = additionSmoothed[i];
    const timeDiffMs = currPoint.timestamp - prevPoint.timestamp;
    
    if (timeDiffMs < MIN_TIME_BETWEEN_POINTS_MS) {
      continue;
    }
    
    const changeM3 = currPoint.value - prevPoint.value;
    
    // Only count increases that meet thresholds
    if (changeM3 > 0) {
      const meetsQuantity = changeM3 >= additionThresholdM3;
      const meetsDuration = timeDiffMs >= ADDITION_MIN_DURATION_MS;
      
      if (meetsQuantity && meetsDuration) {
        totalAdded += changeM3;
      }
    }
    
    lastAdditionPoint = currPoint;
  }
  
  this.app.debug(`TankageEngine: ${path} - Consumed: ${(totalConsumed * M3_TO_GAL).toFixed(2)} gal (8hr smooth), Added: ${(totalAdded * M3_TO_GAL).toFixed(2)} gal (1hr smooth)`);
  
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
  
  // Calculate consumption smoothing window based on data range
  const dataRangeMs = dataPoints[dataPoints.length - 1].timestamp - dataPoints[0].timestamp;
  const smoothingPercent = dataRangeMs <= SHORT_PERIOD_THRESHOLD_MS 
    ? SHORT_PERIOD_SMOOTHING_PERCENT 
    : LONG_PERIOD_SMOOTHING_PERCENT;
  const consumptionSmoothingMs = dataRangeMs * smoothingPercent;
  
  // CONSUMPTION - Dual smoothing (40% for ≤24h, 35% for >24h)
  const consumptionSmoothed = [];
  for (let i = 0; i < dataPoints.length; i++) {
    const currentPoint = dataPoints[i];
    const windowStart = currentPoint.timestamp - consumptionSmoothingMs;
    
    const windowPoints = [];
    for (let j = 0; j <= i; j++) {
      if (dataPoints[j].timestamp >= windowStart) {
        windowPoints.push(dataPoints[j]);
      }
    }
    
    const avgValue = windowPoints.reduce((sum, p) => sum + p.value, 0) / windowPoints.length;
    consumptionSmoothed.push({
      timestamp: currentPoint.timestamp,
      value: avgValue
    });
  }
  
  let totalConsumed = 0;
  let lastConsumptionPoint = consumptionSmoothed[0];
  
  for (let i = 1; i < consumptionSmoothed.length; i++) {
    const prevPoint = lastConsumptionPoint;
    const currPoint = consumptionSmoothed[i];
    const timeDiffMs = currPoint.timestamp - prevPoint.timestamp;
    
    if (timeDiffMs < MIN_TIME_BETWEEN_POINTS_MS) {
      continue;
    }
    
    const changeM3 = currPoint.value - prevPoint.value;
    
    if (changeM3 < 0) {
      totalConsumed += Math.abs(changeM3);
    }
    
    lastConsumptionPoint = currPoint;
  }
  
  // ADDITION - Light smoothing (1 hour)
  const additionSmoothed = [];
  for (let i = 0; i < dataPoints.length; i++) {
    const currentPoint = dataPoints[i];
    const windowStart = currentPoint.timestamp - ADDITION_SMOOTHING_MS;
    
    const windowPoints = [];
    for (let j = 0; j <= i; j++) {
      if (dataPoints[j].timestamp >= windowStart) {
        windowPoints.push(dataPoints[j]);
      }
    }
    
    const avgValue = windowPoints.reduce((sum, p) => sum + p.value, 0) / windowPoints.length;
    additionSmoothed.push({
      timestamp: currentPoint.timestamp,
      value: avgValue
    });
  }
  
  let totalAdded = 0;
  let lastAdditionPoint = additionSmoothed[0];
  
  for (let i = 1; i < additionSmoothed.length; i++) {
    const prevPoint = lastAdditionPoint;
    const currPoint = additionSmoothed[i];
    const timeDiffMs = currPoint.timestamp - prevPoint.timestamp;
    
    if (timeDiffMs < MIN_TIME_BETWEEN_POINTS_MS) {
      continue;
    }
    
    const changeM3 = currPoint.value - prevPoint.value;
    
    if (changeM3 > 0) {
      const meetsQuantity = changeM3 >= additionThresholdM3;
      const meetsDuration = timeDiffMs >= ADDITION_MIN_DURATION_MS;
      
      if (meetsQuantity && meetsDuration) {
        totalAdded += changeM3;
      }
    }
    
    lastAdditionPoint = currPoint;
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