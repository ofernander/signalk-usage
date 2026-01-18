function Publisher(app, usageCoordinator, options) {
  this.app = app;
  this.usageCoordinator = usageCoordinator;
  this.options = options;
  this.publishTimer = null;
}

Publisher.prototype.start = function() {
  const interval = (this.options.reporting?.updateInterval || 20) * 1000;

  this.app.debug(`Starting publisher (interval: ${interval}ms)`);

  // Publish immediately (will skip if not ready)
  this.publish();

  const self = this;
  this.publishTimer = setInterval(() => {
    self.publish();
  }, interval);
};

Publisher.prototype.round = function(value) {
  // Round to 1 decimal place
  return Math.round(value * 10) / 10;
};

Publisher.prototype.publish = function() {
  const usageData = this.usageCoordinator.getUsageData();
  
  // Don't publish if data isn't ready yet
  if (!usageData.ready) {
    this.app.debug('Publisher: Data not ready yet, skipping publish');
    return;
  }
  
  const deltas = [];
  const meta = [];

  // Items are already separated by engine type
  const items = usageData.items || {};
  
  // Separate by checking item unit (power items have 'watts', tankage has m3/ratio)
  const tankageItems = {};
  const powerItems = {};
  
  Object.entries(items).forEach(([path, item]) => {
    if (item.unit === 'watts') {
      powerItems[path] = item;
    } else {
      tankageItems[path] = item;
    }
  });

  this.app.debug(`Publishing ${Object.keys(tankageItems).length} tankage items, ${Object.keys(powerItems).length} power items`);

  this.publishTankageItems(tankageItems, deltas, meta);
  this.publishPowerItems(powerItems, deltas, meta);

  if (deltas.length > 0) {
    const delta = {
      context: 'vessels.' + this.app.selfId,
      updates: [{
        timestamp: new Date().toISOString(),
        values: deltas,
        meta: meta
      }]
    };
    
    this.app.handleMessage('signalk-usage', delta);

    this.app.debug(`Published ${deltas.length} values to SignalK`);
  } else {
    this.app.debug('No deltas to publish');
  }
};

Publisher.prototype.publishTankageItems = function(items, deltas, meta) {
  Object.values(items).forEach(item => {
    this.app.debug(`Publishing tankage item: ${item.path}`);
    const basePath = this.getBasePath(item);

    // Each item has its own periods - publish all of them
    Object.entries(item.periods || {}).forEach(([period, periodData]) => {
      const unit = item.unit || 'm3';
      
      // Check if this period has insufficient data
      if (periodData.insufficientData) {
        this.app.debug(`  ${period}: Insufficient data - publishing null (${periodData.reason})`);
        
        // Publish null values for this period
        deltas.push({ path: `${basePath}.consumed.${period}`, value: null });
        meta.push({ path: `${basePath}.consumed.${period}`, value: { units: unit } });
        
        deltas.push({ path: `${basePath}.added.${period}`, value: null });
        meta.push({ path: `${basePath}.added.${period}`, value: { units: unit } });
        
        deltas.push({ path: `${basePath}.consumptionRate.${period}`, value: null });
        meta.push({ path: `${basePath}.consumptionRate.${period}`, value: { units: `${unit}/h` } });
        
        return;
      }
      
      // Publish normal values (rounded to 1 decimal)
      deltas.push({
        path: `${basePath}.consumed.${period}`,
        value: this.round(periodData.consumed || 0)
      });
      meta.push({
        path: `${basePath}.consumed.${period}`,
        value: { units: unit }
      });
      
      deltas.push({
        path: `${basePath}.added.${period}`,
        value: this.round(periodData.added || 0)
      });
      meta.push({
        path: `${basePath}.added.${period}`,
        value: { units: unit }
      });
      
      deltas.push({
        path: `${basePath}.consumptionRate.${period}`,
        value: this.round(periodData.consumptionRate || 0)
      });
      meta.push({
        path: `${basePath}.consumptionRate.${period}`,
        value: { units: `${unit}/h` }
      });
    });
  });
};

Publisher.prototype.isBattery = function(item) {
  const pathLower = item.path.toLowerCase();
  return pathLower.includes('battery') || pathLower.includes('batt');
};

Publisher.prototype.publishPowerItems = function(items, deltas, meta) {
  Object.values(items).forEach(item => {
    this.app.debug(`Publishing power item: ${item.path}`);
    const basePath = this.getBasePath(item);
    const isBattery = this.isBattery(item);

    // Each item has its own periods - publish all of them
    Object.entries(item.periods || {}).forEach(([period, periodData]) => {
      const directionality = item.directionality;
      
      // Battery gets special naming: charged/discharged
      const consumedLabel = isBattery ? 'dischargedWh' : 'consumedWh';
      const generatedLabel = isBattery ? 'chargedWh' : 'generatedWh';
      
      // Check if this period has insufficient data
      if (periodData.insufficientData) {
        this.app.debug(`  ${period}: Insufficient data - publishing null (${periodData.reason})`);
        
        // Publish null values based on directionality
        if (directionality === 'producer') {
          deltas.push({ path: `${basePath}.${generatedLabel}.${period}`, value: null });
          meta.push({ path: `${basePath}.${generatedLabel}.${period}`, value: { units: 'Wh' } });
        } else if (directionality === 'consumer') {
          deltas.push({ path: `${basePath}.${consumedLabel}.${period}`, value: null });
          meta.push({ path: `${basePath}.${consumedLabel}.${period}`, value: { units: 'Wh' } });
        } else {
          // Bidirectional - publish both as null
          deltas.push({ path: `${basePath}.${consumedLabel}.${period}`, value: null });
          meta.push({ path: `${basePath}.${consumedLabel}.${period}`, value: { units: 'Wh' } });
          
          deltas.push({ path: `${basePath}.${generatedLabel}.${period}`, value: null });
          meta.push({ path: `${basePath}.${generatedLabel}.${period}`, value: { units: 'Wh' } });
        }
        
        return;
      }
      
      // Skip if no energy data
      if (!periodData.energy) return;
      
      // Publish normal values (rounded to 1 decimal)
      if (directionality === 'producer') {
        // Only publish generated
        deltas.push({
          path: `${basePath}.${generatedLabel}.${period}`,
          value: this.round(periodData.energy.generatedWh || 0)
        });
        meta.push({
          path: `${basePath}.${generatedLabel}.${period}`,
          value: { units: 'Wh' }
        });
      } else if (directionality === 'consumer') {
        // Only publish consumed
        deltas.push({
          path: `${basePath}.${consumedLabel}.${period}`,
          value: this.round(periodData.energy.consumedWh || 0)
        });
        meta.push({
          path: `${basePath}.${consumedLabel}.${period}`,
          value: { units: 'Wh' }
        });
      } else {
        // Bidirectional or auto-detected - publish both
        deltas.push({
          path: `${basePath}.${consumedLabel}.${period}`,
          value: this.round(periodData.energy.consumedWh || 0)
        });
        meta.push({
          path: `${basePath}.${consumedLabel}.${period}`,
          value: { units: 'Wh' }
        });
        
        deltas.push({
          path: `${basePath}.${generatedLabel}.${period}`,
          value: this.round(periodData.energy.generatedWh || 0)
        });
        meta.push({
          path: `${basePath}.${generatedLabel}.${period}`,
          value: { units: 'Wh' }
        });
      }
    });
  });
};

Publisher.prototype.getBasePath = function(item) {
  // If user provided a custom name, use it in the path
  // Otherwise use the full SignalK path
  if (item.name && item.name !== item.path) {
    return 'usage.' + item.name;
  }
  return 'usage.' + item.path;
};

Publisher.prototype.stop = function() {
  if (this.publishTimer) {
    clearInterval(this.publishTimer);
    this.publishTimer = null;
    this.app.debug('Publisher stopped');
  }
};

module.exports = Publisher;