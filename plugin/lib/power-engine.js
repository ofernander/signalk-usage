function PowerEngine(app, influxClient, options) {
  this.app = app;
  this.influxClient = influxClient;
  this.options = options;
  
  this.cache = new Map();
  this.cacheEnabled = options.reporting?.cacheResults !== false;
}

PowerEngine.prototype.calculateAll = async function() {
  this.app.debug('PowerEngine: Calculating usage for all power items');
  
  const powerItems = (this.options.power || [])
    .filter(item => item.enabled !== false);
  
  const promises = powerItems.map(item => this.calculateForItem(item));
  await Promise.all(promises);
};

PowerEngine.prototype.calculateForItem = async function(item) {
  const { path } = item;
  
  this.app.debug(`PowerEngine: Calculating usage for ${path}`);
  
  // Get periods from item config (fallback to defaults if not specified)
  const periods = item.periods || [
    { range: '1h', aggregation: '1m' },
    { range: '24h', aggregation: '15m' },
    { range: '7d', aggregation: '1h' }
  ];
  
  const itemData = {
    path: path,
    name: item.name || path,
    unit: 'watts',
    directionality: item.directionality,
    capacity: item.capacity,
    periods: {}
  };

  for (const period of periods) {
    try {
      const usage = await this.calculateUsageForPeriod(item, period);
      itemData.periods[period.range] = usage;
    } catch (err) {
      this.app.debug(`PowerEngine: Error calculating ${period.range} usage for ${path}: ${err.message}`);
      itemData.periods[period.range] = { error: err.message };
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

PowerEngine.prototype.parseAggregationWindow = function(aggregation) {
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

PowerEngine.prototype.parseTimeRange = function(range) {
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

PowerEngine.prototype.calculateUsageForPeriod = async function(item, period) {
  const { path, directionality } = item;
  const { range, aggregation } = period;
  const rangeParam = `-${range}`;
  
  // Determine directionality (explicit or auto-detect)
  let effectiveDirectionality = directionality;
  if (!effectiveDirectionality) {
    effectiveDirectionality = this.autoDetectDirectionalityType(path);
  }
  
  this.app.debug(`PowerEngine: Calculating ${range} for ${path} (aggregation: ${aggregation || 'auto'}, directionality: ${effectiveDirectionality})`);
  
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

  // Energy calculation using integration with aggregated data
  try {
    this.app.debug(`PowerEngine: Fetching aggregated data for ${path}`);
    const dataPoints = await this.influxClient.queryPath(path, rangeParam, aggregation);
    
    if (!dataPoints || dataPoints.length < 2) {
      this.app.debug(`PowerEngine: Insufficient data points for ${path}: ${dataPoints ? dataPoints.length : 0}`);
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
    
    this.app.debug(`PowerEngine: Coverage for ${path} (${range}): ${uniquePeriods}/${expectedPeriods} ${periodType}`);

    // Check if we have data for every day (or hour)
    if (uniquePeriods < expectedPeriods) {
      this.app.debug(`PowerEngine: Insufficient coverage for ${path} (${range}) - missing ${expectedPeriods - uniquePeriods} ${periodType}`);
      return {
        insufficientData: true,
        reason: `Insufficient coverage (${uniquePeriods}/${expectedPeriods} ${periodType})`
      };
    }

    this.app.debug(`PowerEngine: Integrating ${dataPoints.length} aggregated data points for ${path} (${range})`);

    // Parse aggregation window to detect gaps
    const expectedIntervalMinutes = this.parseAggregationWindow(aggregation);
    const gapThresholdMs = expectedIntervalMinutes * 2 * 60 * 1000; // 2x expected interval
    
    this.app.debug(`  Gap threshold: ${(gapThresholdMs / 1000 / 60).toFixed(1)} minutes (2x ${expectedIntervalMinutes}m aggregation)`);

    let totalEnergyWh = 0;
    let positiveEnergyWh = 0;
    let negativeEnergyWh = 0;
    let gapsDetected = 0;
    let gapTimeHours = 0;
    let skippedNoise = 0;

    // Integrate using trapezoidal rule - KEEP zeros, only skip noise
    for (let i = 1; i < dataPoints.length; i++) {
      const p1 = dataPoints[i - 1];
      const p2 = dataPoints[i];
      
      const timeDiffMs = p2.timestamp - p1.timestamp;
      const timeDiffHours = timeDiffMs / (1000 * 60 * 60);
      const avgPower = (p1.value + p2.value) / 2;
      
      // ONLY skip negative noise for producer/consumer (not zeros!)
      let shouldSkip = false;
      
      if (effectiveDirectionality === 'producer' && avgPower < 0) {
        shouldSkip = true;
        skippedNoise++;
      } else if (effectiveDirectionality === 'consumer' && avgPower < 0) {
        shouldSkip = true;
        skippedNoise++;
      }
      
      if (shouldSkip) {
        continue; // Skip this noise window
      }
      
      // Check if this is a data gap (missing windows)
      if (timeDiffMs > gapThresholdMs) {
        // GAP DETECTED - use last known value for the gap
        gapsDetected++;
        gapTimeHours += timeDiffHours;
        
        // Energy during gap = last known power * gap duration
        const gapEnergy = p1.value * timeDiffHours;
        
        totalEnergyWh += gapEnergy;
        
        if (gapEnergy > 0) {
          positiveEnergyWh += gapEnergy;
        } else {
          negativeEnergyWh += Math.abs(gapEnergy);
        }
      } else {
        // Normal window - use trapezoidal rule (INCLUDING zeros)
        const energy = avgPower * timeDiffHours;
        
        totalEnergyWh += energy;
        
        if (energy > 0) {
          positiveEnergyWh += energy;
        } else {
          negativeEnergyWh += Math.abs(energy);
        }
      }
    }
    
    if (skippedNoise > 0) {
      this.app.debug(`  Skipped ${skippedNoise} noise windows (negative values)`);
    }
    
    if (gapsDetected > 0) {
      this.app.debug(`  Detected ${gapsDetected} data gaps totaling ${gapTimeHours.toFixed(1)} hours - filled with last known values`);
    }
    
    // Apply directionality logic
    const result = this.applyDirectionality(path, effectiveDirectionality, positiveEnergyWh, negativeEnergyWh);
    
    this.app.debug(`PowerEngine: Energy for ${path} (${range}):`);
    this.app.debug(`  Consumed: ${result.consumedWh.toFixed(2)} Wh`);
    this.app.debug(`  Generated: ${result.generatedWh.toFixed(2)} Wh`);
    this.app.debug(`  Directionality: ${result.appliedDirectionality}`);
    
    usage.energy = {
      consumedWh: result.consumedWh,
      generatedWh: result.generatedWh
    };
  } catch (err) {
    this.app.debug(`PowerEngine: Error calculating energy for ${path}: ${err.message}`);
    this.app.debug(`Stack trace: ${err.stack}`);
    return {
      insufficientData: true,
      reason: `Error: ${err.message}`
    };
  }

  return usage;
};

PowerEngine.prototype.autoDetectDirectionalityType = function(path) {
  const pathLower = path.toLowerCase();
  
  if (pathLower.includes('solar') || pathLower.includes('panel') || pathLower.includes('alternator')) {
    return 'producer';
  } else if (pathLower.includes('acin') || pathLower.includes('shore')) {
    return 'consumer';
  } else if (pathLower.includes('battery') && !pathLower.includes('acout')) {
    return 'bidirectional-reversed';
  } else {
    return 'bidirectional-normal';
  }
};

PowerEngine.prototype.applyDirectionality = function(path, directionality, positiveEnergyWh, negativeEnergyWh) {
  let consumedWh, generatedWh, appliedDirectionality;
  
  switch (directionality) {
    case 'producer':
      consumedWh = 0;
      generatedWh = positiveEnergyWh;
      appliedDirectionality = 'producer (explicit)';
      if (negativeEnergyWh > 0.1) {
        this.app.debug(`  Note: Filtered out ${negativeEnergyWh.toFixed(2)} Wh negative energy (noise)`);
      }
      break;
      
    case 'consumer':
      consumedWh = positiveEnergyWh;
      generatedWh = 0;
      appliedDirectionality = 'consumer (explicit)';
      if (negativeEnergyWh > 0.1) {
        this.app.debug(`  Note: Filtered out ${negativeEnergyWh.toFixed(2)} Wh negative energy (noise)`);
      }
      break;
      
    case 'bidirectional-normal':
      consumedWh = negativeEnergyWh;
      generatedWh = positiveEnergyWh;
      appliedDirectionality = 'bidirectional-normal (explicit)';
      break;
      
    case 'bidirectional-reversed':
      consumedWh = positiveEnergyWh;
      generatedWh = negativeEnergyWh;
      appliedDirectionality = 'bidirectional-reversed (explicit)';
      break;
      
    default:
      this.app.debug(`  WARNING: Unknown directionality '${directionality}' for ${path}, using auto-detection`);
      const detectedType = this.autoDetectDirectionalityType(path);
      return this.applyDirectionality(path, detectedType, positiveEnergyWh, negativeEnergyWh);
  }
  
  return {
    consumedWh: consumedWh,
    generatedWh: generatedWh,
    appliedDirectionality: appliedDirectionality
  };
};

PowerEngine.prototype.getUsageData = function() {
  const data = {};
  
  this.cache.forEach((cached, path) => {
    data[path] = cached.data;
  });

  return data;
};

PowerEngine.prototype.getUsageForPath = function(path) {
  const cached = this.cache.get(path);
  return cached ? cached.data : null;
};

PowerEngine.prototype.stop = function() {
  this.cache.clear();
};

module.exports = PowerEngine;