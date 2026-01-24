const PowerEngine = require('./powerEngine');
const TankageEngine = require('./tankageEngine');

function UsageCoordinator(app, influxClient, options) {
  this.app = app;
  this.influxClient = influxClient;
  this.options = options;
  
  this.powerEngine = new PowerEngine(app, influxClient, options);
  this.tankageEngine = new TankageEngine(app, influxClient, options);
  
  // Track if we've completed at least one full calculation
  this.isReady = false;
  this.isCalculating = false;
}

UsageCoordinator.prototype.calculateAll = async function() {
  if (this.isCalculating) {
    this.app.debug('UsageCoordinator: Calculation already in progress, skipping');
    return;
  }
  
  this.isCalculating = true;
  this.app.debug('UsageCoordinator: Starting calculation for all items');
  
  try {
    // Calculate power and tankage in parallel
    await Promise.all([
      this.powerEngine.calculateAll(),
      this.tankageEngine.calculateAll()
    ]);
    
    this.isReady = true;
    this.app.debug('UsageCoordinator: Calculation complete');
  } finally {
    this.isCalculating = false;
  }
};

UsageCoordinator.prototype.getUsageData = function() {
  if (!this.isReady) {
    this.app.debug('UsageCoordinator: Data not ready yet, returning empty');
    return {
      timestamp: Date.now(),
      items: {},
      ready: false
    };
  }
  
  const data = {
    items: {}
  };
  
  // Merge power and tankage items
  const powerData = this.powerEngine.getUsageData();
  const tankageData = this.tankageEngine.getUsageData();
  
  data.items = { ...powerData, ...tankageData };

  return {
    timestamp: Date.now(),
    ready: true,
    ...data
  };
};

UsageCoordinator.prototype.getUsageForPath = function(path) {
  // Try power first, then tankage
  let data = this.powerEngine.getUsageForPath(path);
  if (!data) {
    data = this.tankageEngine.getUsageForPath(path);
  }
  return data;
};

UsageCoordinator.prototype.findItemConfig = function(path) {
  // Check power items
  const powerItems = this.options.power || [];
  for (const item of powerItems) {
    if (item.path === path) {
      return { ...item, type: 'power' };
    }
  }
  
  // Check tankage items
  const tankageItems = this.options.tankage || [];
  for (const item of tankageItems) {
    if (item.path === path) {
      return { ...item, type: 'tankage' };
    }
  }
  
  return null;
};

UsageCoordinator.prototype.calculateAggregation = function(rangeMs) {
  // Calculate a sensible aggregation window based on time range
  const rangeHours = rangeMs / (1000 * 60 * 60);
  
  if (rangeHours <= 1) return '1m';      // Up to 1 hour: 1 minute
  if (rangeHours <= 6) return '5m';      // Up to 6 hours: 5 minutes
  if (rangeHours <= 24) return '15m';    // Up to 1 day: 15 minutes
  if (rangeHours <= 168) return '1h';    // Up to 7 days: 1 hour
  if (rangeHours <= 720) return '4h';    // Up to 30 days: 4 hours
  return '12h';                          // More than 30 days: 12 hours
};

UsageCoordinator.prototype.calculateEnergyFromData = function(dataPoints, itemConfig) {
  if (!dataPoints || dataPoints.length < 2) {
    return { consumedWh: 0, generatedWh: 0 };
  }

  // Use the power engine's directionality logic
  const directionality = itemConfig.directionality || 
                        this.powerEngine.autoDetectDirectionalityType(itemConfig.path);

  let positiveEnergyWh = 0;
  let negativeEnergyWh = 0;

  // Integrate using trapezoidal rule
  for (let i = 1; i < dataPoints.length; i++) {
    const p1 = dataPoints[i - 1];
    const p2 = dataPoints[i];
    
    const timeDiffMs = p2.timestamp - p1.timestamp;
    const timeDiffHours = timeDiffMs / (1000 * 60 * 60);
    const avgPower = (p1.value + p2.value) / 2;
    
    const energy = avgPower * timeDiffHours;
    
    if (energy > 0) {
      positiveEnergyWh += energy;
    } else {
      negativeEnergyWh += Math.abs(energy);
    }
  }

  // Apply directionality
  return this.powerEngine.applyDirectionality(
    itemConfig.path,
    directionality,
    positiveEnergyWh,
    negativeEnergyWh
  );
};

UsageCoordinator.prototype.stop = function() {
  this.powerEngine.stop();
  this.tankageEngine.stop();
};

module.exports = UsageCoordinator;