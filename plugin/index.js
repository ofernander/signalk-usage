const schema = require('./lib/schema');
const InfluxClient = require('./lib/influx-client');
const UsageCoordinator = require('./lib/usage-coordinator');
const Publisher = require('./lib/publisher');

module.exports = function (app) {
  let plugin = {
    id: 'signalk-usage',
    name: 'SignalK Usage',
    description: 'Report Electrical and Tank Usage',
    schema: schema,
    
    influxClient: null,
    usageCoordinator: null,
    publisher: null,
    updateTimer: null
  };

  plugin.start = function (options, restartPlugin) {
    try {
      app.debug('Starting SignalK Usage plugin');
      
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
      app.debug('Stopping SignalK Usage plugin');
      
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

  // API endpoint to get usage data
  plugin.registerWithRouter = function (router) {
    router.get('/usage', (req, res) => {
      try {
        const data = plugin.usageCoordinator.getUsageData();
        res.json(data);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    router.get('/usage/:path', (req, res) => {
      try {
        const data = plugin.usageCoordinator.getUsageForPath(req.params.path);
        if (!data) {
          res.status(404).json({ error: 'Path not found' });
        } else {
          res.json(data);
        }
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
  };

  return plugin;
};