const PowerEngine = require('./power-engine');
const TankageEngine = require('./tankage-engine');

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

UsageCoordinator.prototype.stop = function() {
  this.powerEngine.stop();
  this.tankageEngine.stop();
};

module.exports = UsageCoordinator;