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
  
  // Get periods from item config (fallback to defaults if not specified)
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
      data: itemData,
      timestamp: Date.now()
    });
  }

  return itemData;
};

TankageEngine.prototype.parseAggregationWindow = function(aggregation) {
  // Parse aggregation string like "30m", "1h", "1d" to minutes
  const match = aggregation.match(/^(\d+)([smhd])$/);
  if (!match) return 60; // Default to 60 minutes if can't parse
  
  const value = parseInt(match[1]);
  const unit = match[2];
  
  switch (unit) {
    case 's': return value / 60;
    case 'm': return value;
    case 'h': return value * 60;
    case 'd': return value * 24 * 60;
    default: return 60;
  }
};

TankageEngine.prototype.parseTimeRange = function(range) {
  // Parse range string like "1h", "7d", "365d" to hours
  const match = range.match(/^(\d+)([smhd])$/);
  if (!match) return 1; // Default to 1 hour if can't parse
  
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

TankageEngine.prototype.calculateUsageForPeriod = async function(item, period) {
  const { path } = item;
  const { range, aggregation } = period;
  const rangeParam = `-${range}`;
  
  this.app.debug(`TankageEngine: Calculating ${range} for ${path} (aggregation: ${aggregation || 'auto'})`);
  
  const { first, last } = await this.influxClient.getFirstAndLast(path, rangeParam);
  
  if (!first || !last) {
    return {
      insufficientData: true,
      reason: 'No data available for this period'
    };
  }

  const delta = last.value - first.value;
  const timeDiffHours = (last.timestamp - first.timestamp) / (1000 * 60 * 60);
  
  const usage = {
    period: range,
    startTime: first.timestamp,
    endTime: last.timestamp,
    startValue: first.value,
    endValue: last.value,
    delta: delta
  };

  // Use aggregated data - naturally filters boat motion via time-windowed averaging
  try {
    this.app.debug(`TankageEngine: Fetching aggregated data for ${path}`);
    const dataPoints = await this.influxClient.queryPath(path, rangeParam, aggregation);
    
    if (!dataPoints || dataPoints.length < 2) {
      this.app.debug(`TankageEngine: Insufficient data points for ${path}: ${dataPoints ? dataPoints.length : 0}`);
      return {
        insufficientData: true,
        reason: 'Insufficient data points'
      };
    }

    // Check coverage based on unique days (or hours for sub-day periods)
    const rangeHours = this.parseTimeRange(range);
    
    let uniquePeriods, expectedPeriods, periodType;
    
    if (rangeHours >= 24) {
      // For periods >= 1 day, check daily coverage
      const uniqueDays = new Set(dataPoints.map(p => {
        const date = new Date(p.timestamp);
        return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
      }));
      uniquePeriods = uniqueDays.size;
      expectedPeriods = Math.ceil(rangeHours / 24);
      periodType = 'days';
    } else {
      // For periods < 1 day, check hourly coverage
      const uniqueHours = new Set(dataPoints.map(p => {
        const date = new Date(p.timestamp);
        return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}-${String(date.getUTCHours()).padStart(2, '0')}`;
      }));
      uniquePeriods = uniqueHours.size;
      expectedPeriods = Math.ceil(rangeHours);
      periodType = 'hours';
    }
    
    this.app.debug(`TankageEngine: Coverage for ${path} (${range}): ${uniquePeriods}/${expectedPeriods} ${periodType}`);

    // Check if we have data for every day (or hour)
    if (uniquePeriods < expectedPeriods) {
      this.app.debug(`TankageEngine: Insufficient coverage for ${path} (${range}) - missing ${expectedPeriods - uniquePeriods} ${periodType}`);
      return {
        insufficientData: true,
        reason: `Insufficient coverage (${uniquePeriods}/${expectedPeriods} ${periodType})`
      };
    }

    // Time-based filtering approach: track ups/downs but ignore rapid changes (< x min)
    // This filters sensor noise while catching real consumption and refills
    const MIN_TIME_DIFF_MS = 2 * 60 * 1000; 
    
    let totalConsumed = 0;
    let totalAdded = 0;
    let lastTrackedPoint = dataPoints[0];
    
    for (let i = 1; i < dataPoints.length; i++) {
      const prev = lastTrackedPoint;
      const curr = dataPoints[i];
      const timeDiffMs = curr.timestamp - prev.timestamp;
      
      // Only process changes that are at least 5 minutes apart
      if (timeDiffMs >= MIN_TIME_DIFF_MS) {
        const change = curr.value - prev.value;
        
        if (change > 0) {
          // Tank level increased - added
          totalAdded += change;
        } else if (change < 0) {
          // Tank level decreased - consumed
          totalConsumed += Math.abs(change);
        }
        
        // Update last tracked point
        lastTrackedPoint = curr;
      }

    }
    
    this.app.debug(`TankageEngine: ${path} - Added: ${totalAdded.toFixed(4)} m³ (${(totalAdded / 0.00378541).toFixed(2)} gal), Consumed: ${totalConsumed.toFixed(4)} m³ (${(totalConsumed / 0.00378541).toFixed(2)} gal) from ${dataPoints.length} points`);
    
    usage.consumed = totalConsumed;
    usage.added = totalAdded;
  } catch (err) {
    this.app.debug(`TankageEngine: Error getting aggregated data for ${path}: ${err.message}`);
    return {
      insufficientData: true,
      reason: `Error: ${err.message}`
    };
  }

  // Calculate rates based on actual consumption and addition
  if (timeDiffHours > 0) {
    usage.consumptionRate = usage.consumed / timeDiffHours;
    usage.additionRate = usage.added / timeDiffHours;
  }

  return usage;
};

TankageEngine.prototype.getUsageData = function() {
  const data = {};
  
  this.cache.forEach((cached, path) => {
    data[path] = cached.data;
  });

  return data;
};

TankageEngine.prototype.getUsageForPath = function(path) {
  const cached = this.cache.get(path);
  return cached ? cached.data : null;
};

TankageEngine.prototype.getUnit = function(item) {
  if (item.unit) return item.unit;
  
  const path = item.path.toLowerCase();
  
  // Tank measurements
  if (path.includes('currentlevel')) return 'ratio';
  if (path.startsWith('tanks.') && (path.includes('remaining') || path.includes('currentvolume'))) return 'm3';
  
  return 'unknown';
};

TankageEngine.prototype.stop = function() {
  this.cache.clear();
};

// Calculate tankage totals from raw data points (for custom queries)
// Uses same 5-minute time-based filtering as regular calculations
TankageEngine.prototype.calculateTankageFromData = function(dataPoints) {
  if (!dataPoints || dataPoints.length < 2) {
    return { consumed: 0, added: 0 };
  }

  // Time-based filtering: ignore changes < x minutes apart
  const MIN_TIME_DIFF_MS = 2 * 60 * 1000;
  
  let totalConsumed = 0;
  let totalAdded = 0;
  let lastTrackedPoint = dataPoints[0];
  
  for (let i = 1; i < dataPoints.length; i++) {
    const prev = lastTrackedPoint;
    const curr = dataPoints[i];
    const timeDiffMs = curr.timestamp - prev.timestamp;
    
    // Only process changes that are at least 5 minutes apart
    if (timeDiffMs >= MIN_TIME_DIFF_MS) {
      const change = curr.value - prev.value;
      
      if (change > 0) {
        totalAdded += change;
      } else if (change < 0) {
        totalConsumed += Math.abs(change);
      }
      
      lastTrackedPoint = curr;
    }
  }
  
  return {
    consumed: totalConsumed,
    added: totalAdded
  };
};

module.exports = TankageEngine;