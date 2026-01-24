module.exports = {
  type: 'object',
  required: ['influx'],
  properties: {
    influx: {
      type: 'object',
      title: 'InfluxDB Configuration',
      description: 'Connect to your existing InfluxDB instance where SignalK data is stored',
      required: ['url', 'token', 'org', 'bucket'],
      properties: {
        url: {
          type: 'string',
          title: 'InfluxDB URL',
          default: 'http://localhost:8086',
          description: 'URL of your InfluxDB 2.x instance'
        },
        token: {
          type: 'string',
          title: 'API Token',
          description: 'InfluxDB API token with read permissions'
        },
        org: {
          type: 'string',
          title: 'Organization',
          default: 'signalk',
          description: 'InfluxDB organization name'
        },
        bucket: {
          type: 'string',
          title: 'Bucket',
          default: 'signalk',
          description: 'InfluxDB bucket where SignalK data is stored'
        }
      }
    },
    tankage: {
      type: 'array',
      title: 'Tankage',
      default: [],
      items: {
        type: 'object',
        title: 'Tank',
        required: ['path', 'periods'],
        properties: {
          path: {
            type: 'string',
            title: 'Path',
            description: 'SignalK path (e.g., tanks.freshWater.0.remaining)'
          },
          name: {
            type: 'string',
            title: 'Display Name',
            description: 'Optional friendly name for this tank'
          },
          largeTank: {
            type: 'boolean',
            title: 'Large Tank (≥10 gallons)',
            default: false,
          },
          periods: {
            type: 'array',
            title: 'Time Periods',
            format: 'table',
            default: [
              { range: '1h', aggregation: '30s' },
              { range: '24h', aggregation: '3m' },
              { range: '7d', aggregation: '10m' },
              { range: '30d', aggregation: '15m' }
            ],
            items: {
              type: 'object',
              title: 'Period',
              required: ['range', 'aggregation'],
              properties: {
                range: {
                  type: 'string',
                  title: 'Range',
                  description: 'Time range (e.g., 1h, 24h, 7d, 30d)'
                },
                aggregation: {
                  type: 'string',
                  title: 'Aggregation',
                  description: 'Data aggregation window (e.g., 1m, 15m, 1h)'
                }
              }
            }
          }
        }
      }
    },
    power: {
      type: 'array',
      title: 'Electrical Power',
      default: [],
      items: {
        type: 'object',
        title: 'Power Item',
        required: ['path', 'periods'],
        properties: {
          path: {
            type: 'string',
            title: 'Path',
            description: 'SignalK path (e.g., electrical.batteries.512.power)'
          },
          name: {
            type: 'string',
            title: 'Display Name',
            description: 'Optional friendly name for this item'
          },
          directionality: {
            type: 'string',
            title: 'Directionality',
            enum: ['producer', 'consumer', 'bidirectional', 'auto'],
            default: 'auto',
            description: 'How power flows: producer (generates), consumer (uses), bidirectional (both), or auto (detect from data)'
          },
          periods: {
            type: 'array',
            title: 'Time Periods',
            format: 'table',
            default: [
              { range: '1h', aggregation: '30s' },
              { range: '24h', aggregation: '3m' },
              { range: '7d', aggregation: '10m' },
              { range: '30d', aggregation: '15m' }
            ],
            items: {
              type: 'object',
              title: 'Period',
              required: ['range', 'aggregation'],
              properties: {
                range: {
                  type: 'string',
                  title: 'Range',
                  description: 'Time range (e.g., 1h, 24h, 7d, 30d)'
                },
                aggregation: {
                  type: 'string',
                  title: 'Aggregation',
                  description: 'Data aggregation window (e.g., 1m, 15m, 1h)'
                }
              }
            }
          },
          enabled: {
            type: 'boolean',
            title: 'Enabled',
            default: true
          }
        }
      }
    },
    reporting: {
      type: 'object',
      title: 'Reporting Configuration',
      properties: {
        updateInterval: {
          type: 'number',
          title: 'Update Interval (seconds)',
          default: 300,
          description: 'How often to recalculate usage statistics'
        },
        cacheResults: {
          type: 'boolean',
          title: 'Cache Results',
          default: true,
          description: 'Cache calculated results to reduce InfluxDB queries'
        },
        unitPreference: {
          type: 'string',
          title: 'Volume Units (Web UI)',
          enum: ['metric', 'imperial'],
          default: 'metric',
          description: 'Display volumes in Liters (metric) or Gallons (imperial) in the web interface'
        }
      }
    }
  }
};