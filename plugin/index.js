const schema = require('./lib/schema');
const InfluxClient = require('./lib/influxClient');
const UsageCoordinator = require('./lib/usageCoordinator');
const Publisher = require('./lib/publisher');
const routes = require('./lib/routes');

module.exports = function (app) {
  let plugin = {
    id: 'signalk-usage',
    name: 'SignalK-Usage',
    description: 'Report Electrical and Tank Usage',
    schema: schema,
    
    influxClient: null,
    usageCoordinator: null,
    publisher: null,
    updateTimer: null
  };

  plugin.start = function (options, restartPlugin) {
    try {
      app.debug('Starting SignalK-Usage plugin');
      
      // Validate configuration
      if (!options.influx) {
        app.setPluginError('InfluxDB configuration is required');
        return;
      }

      const tankageItems = options.tankage || [];
      const powerItems = options.power || [];
      
      if (tankageItems.length === 0 && powerItems.length === 0) {
        app.setPluginError('At least one tankage or power item must be configured');
        return;
      }

      // Initialize InfluxDB client (read-only)
      plugin.influxClient = new InfluxClient(
        options.influx,
        app
      );

      // Test connection
      plugin.influxClient.ping()
        .then(() => {
          app.debug('InfluxDB connection successful');
          
          // Initialize usage coordinator
          plugin.usageCoordinator = new UsageCoordinator(
            app,
            plugin.influxClient,
            options
          );
          
          // Start periodic updates
          const updateInterval = (options.reporting?.updateInterval || 60) * 1000;
          
          // Initial calculation
          plugin.usageCoordinator.calculateAll()
            .then(() => {
              app.debug('Initial usage calculation complete');
              
              // Initialize publisher
              plugin.publisher = new Publisher(
                app,
                plugin.usageCoordinator,
                options
              );
              
              plugin.publisher.start();
              
              app.setPluginStatus('Running');
            })
            .catch(err => {
              app.setPluginError(`Initial calculation failed: ${err.message}`);
            });
          
          // Set up periodic recalculation
          plugin.updateTimer = setInterval(() => {
            plugin.usageCoordinator.calculateAll()
              .catch(err => {
                app.debug(`Calculation error: ${err.message}`);
              });
          }, updateInterval);
          
        })
        .catch(err => {
          app.setPluginError(`InfluxDB connection failed: ${err.message}`);
        });

    } catch (err) {
      app.setPluginError(`Failed to start: ${err.message}`);
    }
  };

  plugin.stop = function () {
    try {
      app.debug('Stopping SignalK-Usage plugin');
      
      if (plugin.updateTimer) {
        clearInterval(plugin.updateTimer);
        plugin.updateTimer = null;
      }
      
      if (plugin.publisher) {
        plugin.publisher.stop();
      }
      
      if (plugin.usageCoordinator) {
        plugin.usageCoordinator.stop();
      }
      
      if (plugin.influxClient) {
        plugin.influxClient.close();
      }
      
      app.setPluginStatus('Stopped');
    } catch (err) {
      app.setPluginError(`Error stopping plugin: ${err.message}`);
    }
  };

  // Register routes
  plugin.registerWithRouter = function (router) {
    routes(router, app, plugin);
  };

  return plugin;
};