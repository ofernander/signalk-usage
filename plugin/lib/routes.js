const path = require('path');

module.exports = function(router, app, plugin) {
  // Serve static files from public directory
  router.use('/', (req, res, next) => {
    const express = require('express');
    const staticHandler = express.static(path.join(__dirname, '../../public'));
    staticHandler(req, res, next);
  });

  // Serve index.html at root
  router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/index.html'));
  });

  // Get all usage data
  router.get('/api/usage', (req, res) => {
    try {
      if (!plugin.usageCoordinator) {
        return res.status(503).json({ error: 'Plugin not initialized' });
      }
      
      const data = plugin.usageCoordinator.getUsageData();
      res.json(data);
    } catch (err) {
      app.debug(`Error getting usage data: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // Get usage for specific path
  router.get('/api/usage/:path', (req, res) => {
    try {
      if (!plugin.usageCoordinator) {
        return res.status(503).json({ error: 'Plugin not initialized' });
      }
      
      const data = plugin.usageCoordinator.getUsageForPath(req.params.path);
      if (!data) {
        res.status(404).json({ error: 'Path not found' });
      } else {
        res.json(data);
      }
    } catch (err) {
      app.debug(`Error getting usage for path: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // Custom time range query endpoint
  router.post('/api/query', (req, res) => {
    (async () => {
      try {
        const { path, start, end, aggregation } = req.body;

        if (!path || !start || !end) {
          return res.status(400).json({ 
            error: 'Missing required parameters: path, start, end' 
          });
        }

        if (!plugin.influxClient) {
          return res.status(503).json({ error: 'InfluxDB client not initialized' });
        }

        // Calculate time range
        const startTime = new Date(start);
        const endTime = new Date(end);
        const rangeMs = endTime - startTime;
        
        // Use provided aggregation or calculate default
        const aggWindow = aggregation || plugin.usageCoordinator.calculateAggregation(rangeMs);

        app.debug(`Custom query: ${path} from ${start} to ${end}, aggregation: ${aggWindow}`);

        // Query data from InfluxDB
        const dataPoints = await plugin.influxClient.queryPathCustomRange(
          path,
          start,
          end,
          aggWindow
        );

        if (!dataPoints || dataPoints.length === 0) {
          return res.json({
            data: [],
            start,
            end,
            aggregation: aggWindow,
            message: 'No data found for the specified range'
          });
        }

        // Determine item type
        const itemConfig = plugin.usageCoordinator.findItemConfig(path);
        const isPower = itemConfig && itemConfig.type === 'power';

        let result = {
          data: dataPoints,
          start,
          end,
          aggregation: aggWindow,
          type: isPower ? 'power' : 'tankage'
        };

        // Calculate energy if it's a power item
        if (isPower) {
          result.energy = plugin.usageCoordinator.calculateEnergyFromData(
            dataPoints,
            itemConfig
          );
        } else {
          // Calculate tankage totals using tankageEngine
          result.tankage = plugin.usageCoordinator.tankageEngine.calculateTankageFromData(dataPoints);
        }

        res.json(result);

      } catch (err) {
        app.debug(`Custom query error: ${err.message}`);
        res.status(500).json({ error: err.message });
      }
    })();
  });

  // Get configuration
  router.get('/api/config', (req, res) => {
    try {
      if (!plugin.usageCoordinator) {
        return res.status(503).json({ error: 'Plugin not initialized' });
      }
      
      res.json({
        power: plugin.usageCoordinator.options.power || [],
        tankage: plugin.usageCoordinator.options.tankage || [],
        reporting: plugin.usageCoordinator.options.reporting || {}
      });
    } catch (err) {
      app.debug(`Error getting config: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });
};