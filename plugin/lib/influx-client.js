const { InfluxDB } = require('@influxdata/influxdb-client');
const { PingAPI } = require('@influxdata/influxdb-client-apis');

function InfluxClient(config, app) {
  this.config = config;
  this.app = app;
  this.client = new InfluxDB({
    url: config.url,
    token: config.token
  });
  this.queryApi = this.client.getQueryApi(config.org);
}

InfluxClient.prototype.ping = async function() {
  try {
    const pingAPI = new PingAPI(this.client);
    await pingAPI.getPing();
    return true;
  } catch (err) {
    this.app.debug(`InfluxDB ping failed: ${err.message}`);
    throw err;
  }
};

InfluxClient.prototype.queryPath = async function(path, range, aggregation) {
  // Use provided aggregation window or fall back to smart default
  const window = aggregation || this.getAggregateWindow(range);
  
  const query = `
    from(bucket: "${this.config.bucket}")
      |> range(start: ${range})
      |> filter(fn: (r) => r._measurement == "${path}")
      |> filter(fn: (r) => r._field == "value")
      |> filter(fn: (r) => r.self == "true")
      |> aggregateWindow(every: ${window}, fn: mean, createEmpty: false)
      |> sort(columns: ["_time"])
  `;

  const self = this;
  
  return new Promise((resolve, reject) => {
    const results = [];
    
    self.queryApi.queryRows(query, {
      next: (row, tableMeta) => {
        const obj = tableMeta.toObject(row);
        results.push({
          timestamp: new Date(obj._time),
          value: obj._value
        });
      },
      error: (err) => {
        self.app.debug(`Query error for ${path}: ${err.message}`);
        reject(err);
      },
      complete: () => {
        self.app.debug(`Query complete for ${path}: ${results.length} points (window: ${window})`);
        resolve(results);
      }
    });
  });
};

InfluxClient.prototype.queryPathRaw = async function(path, range) {
  // Query without aggregation for accurate energy integration
  const query = `
    from(bucket: "${this.config.bucket}")
      |> range(start: ${range})
      |> filter(fn: (r) => r._measurement == "${path}")
      |> filter(fn: (r) => r._field == "value")
      |> filter(fn: (r) => r.self == "true")
      |> sort(columns: ["_time"])
  `;
  
  this.app.debug(`Executing raw query for ${path}:`);
  this.app.debug(query);
  
  const self = this;
  
  return new Promise((resolve, reject) => {
    const results = [];
    
    self.queryApi.queryRows(query, {
      next: (row, tableMeta) => {
        const obj = tableMeta.toObject(row);
        results.push({
          timestamp: new Date(obj._time).getTime(), // Convert to milliseconds
          value: obj._value
        });
      },
      error: (err) => {
        self.app.debug(`Query error for ${path}: ${err.message}`);
        reject(err);
      },
      complete: () => {
        self.app.debug(`Raw query complete for ${path}: ${results.length} points`);
        resolve(results);
      }
    });
  });
};

InfluxClient.prototype.getAggregateWindow = function(range) {
  if (range === '-1h' || range === '-15m') return '1m';
  if (range === '-6h') return '5m';
  if (range === '-12h') return '10m';
  if (range === '-24h') return '15m';
  if (range === '-7d') return '1h';
  if (range === '-30d') return '4h';
  if (range === '-90d') return '12h';
  return '1m';
};

InfluxClient.prototype.getFirstAndLast = async function(path, range) {
  const query = `
    from(bucket: "${this.config.bucket}")
      |> range(start: ${range})
      |> filter(fn: (r) => r._measurement == "${path}")
      |> filter(fn: (r) => r._field == "value")
      |> filter(fn: (r) => r.self == "true")
  `;
  
  this.app.debug(`Executing query for ${path}:`);
  this.app.debug(query);
  
  const firstQuery = query + '\n|> first()';
  const lastQuery = query + '\n|> last()';
  
  try {
    const [first, last] = await Promise.all([
      this.executeSingleValueQuery(firstQuery),
      this.executeSingleValueQuery(lastQuery)
    ]);
    
    this.app.debug(`Query results for ${path}: first=${first ? first.value : 'null'}, last=${last ? last.value : 'null'}`);
    
    return { first, last };
  } catch (err) {
    this.app.debug(`Error getting first/last for ${path}: ${err.message}`);
    throw err;
  }
};

InfluxClient.prototype.executeSingleValueQuery = function(query) {
  const self = this;
  return new Promise((resolve, reject) => {
    let result = null;
    
    self.queryApi.queryRows(query, {
      next: (row, tableMeta) => {
        const obj = tableMeta.toObject(row);
        result = {
          timestamp: new Date(obj._time),
          value: obj._value
        };
      },
      error: reject,
      complete: () => resolve(result)
    });
  });
};

InfluxClient.prototype.close = function() {
  try {
    this.app.debug('InfluxDB client closed');
  } catch (err) {
    this.app.debug(`Error closing InfluxDB client: ${err.message}`);
  }
};

module.exports = InfluxClient;