const PowerEngine = require('./power-engine');
const TankageEngine = require('./tankage-engine');

function UsageCoordinator(app, influxClient, options) {
  this.app = app;
  this.influxClient = influxClient;
  this.options = options;
  
  this.powerEngine = new PowerEngine(app, influxClient, options);
  this.tankageEngine = new TankageEngine(app, influxClient, options);
  
  this.groupCache = new Map();
  this.cacheEnabled = options.reporting?.cacheResults !== false;
  
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
    
    // Calculate groups after individual items are done
    await this.calculateGroups();
    
    this.isReady = true;
    this.app.debug('UsageCoordinator: Calculation complete');
  } finally {
    this.isCalculating = false;
  }
};

UsageCoordinator.prototype.calculateGroups = async function() {
  const groups = this.options.groups || [];
  
  for (const group of groups) {
    this.app.debug(`UsageCoordinator: Calculating group: ${group.id}`);
    
    // Collect all unique periods from items in this group
    const periodSet = new Set();
    
    for (const path of group.paths) {
      let itemData;
      if (group.type === 'tankage') {
        itemData = this.tankageEngine.getUsageForPath(path);
      } else if (group.type === 'power') {
        itemData = this.powerEngine.getUsageForPath(path);
      }
      
      if (itemData && itemData.periods) {
        Object.keys(itemData.periods).forEach(period => periodSet.add(period));
      }
    }
    
    const periods = Array.from(periodSet);
    this.app.debug(`  Group ${group.id} has periods: ${periods.join(', ')}`);
    
    const groupData = {
      id: group.id,
      name: group.name,
      type: group.type,
      paths: group.paths,
      periods: {}
    };
    
    for (const periodRange of periods) {
      const periodData = {
        period: periodRange
      };
      
      if (group.type === 'tankage') {
        periodData.consumed = 0;
        periodData.added = 0;
        
        for (const path of group.paths) {
          const itemData = this.tankageEngine.getUsageForPath(path);
          if (itemData && itemData.periods[periodRange]) {
            const itemPeriod = itemData.periods[periodRange];
            periodData.consumed += itemPeriod.consumed || 0;
            periodData.added += itemPeriod.added || 0;
          }
        }
      } else if (group.type === 'power') {
        periodData.energy = {
          consumedWh: 0,
          generatedWh: 0
        };
        
        for (const path of group.paths) {
          const itemData = this.powerEngine.getUsageForPath(path);
          if (itemData && itemData.periods[periodRange]) {
            const itemPeriod = itemData.periods[periodRange];
            if (itemPeriod.energy) {
              periodData.energy.consumedWh += itemPeriod.energy.consumedWh || 0;
              periodData.energy.generatedWh += itemPeriod.energy.generatedWh || 0;
            }
          }
        }
      }
      
      groupData.periods[periodRange] = periodData;
    }
    
    if (this.cacheEnabled) {
      this.groupCache.set(group.id, {
        data: groupData,
        timestamp: Date.now()
      });
    }
  }
};

UsageCoordinator.prototype.getUsageData = function() {
  if (!this.isReady) {
    this.app.debug('UsageCoordinator: Data not ready yet, returning empty');
    return {
      timestamp: Date.now(),
      items: {},
      groups: {},
      ready: false
    };
  }
  
  const data = {
    items: {},
    groups: {}
  };
  
  // Merge power and tankage items
  const powerData = this.powerEngine.getUsageData();
  const tankageData = this.tankageEngine.getUsageData();
  
  data.items = { ...powerData, ...tankageData };
  
  // Add groups
  this.groupCache.forEach((cached, groupId) => {
    data.groups[groupId] = cached.data;
  });

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
  this.groupCache.clear();
};

module.exports = UsageCoordinator;