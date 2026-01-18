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
            title: 'Name',
            description: 'Display name (optional, defaults to path)'
          },
          periods: {
            type: 'array',
            title: 'Time Periods',
            format: 'table',
            default: [
              { range: '1h', aggregation: '1m' },
              { range: '24h', aggregation: '3m' },
              { range: '7d', aggregation: '5m' },
              { range: '30d', aggregation: '10m' }
            ],
            items: {
              type: 'object',
              title: 'Period',
              required: ['range', 'aggregation'],
              properties: {
                range: {
                  type: 'string',
                  title: 'Range'
                },
                aggregation: {
                  type: 'string',
                  title: 'Aggregation'
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
    power: {
      type: 'array',
      title: 'Electrical Power',
      default: [],
      items: {
        type: 'object',
        title: 'Power Source',
        required: ['path', 'periods'],
        properties: {
          path: {
            type: 'string',
            title: 'Path',
            description: 'SignalK path (e.g., electrical.batteries.512.power)'
          },
          name: {
            type: 'string',
            title: 'Name',
            description: 'Display name (optional, defaults to path)'
          },
          directionality: {
            type: 'string',
            title: 'Direction',
            enum: ['', 'producer', 'consumer', 'bidirectional-normal', 'bidirectional-reversed'],
            description: 'Energy flow direction (blank = auto-detect)',
            default: ''
          },
          periods: {
            type: 'array',
            title: 'Time Periods',
            format: 'table',
            default: [
              { range: '1h', aggregation: '1m' },
              { range: '24h', aggregation: '3m' },
              { range: '7d', aggregation: '5m' },
              { range: '30d', aggregation: '10m' }
            ],
            items: {
              type: 'object',
              title: 'Period',
              required: ['range', 'aggregation'],
              properties: {
                range: {
                  type: 'string',
                  title: 'Range'
                },
                aggregation: {
                  type: 'string',
                  title: 'Aggregation'
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
          default: 20,
          description: 'How often to recalculate usage statistics'
        },
        cacheResults: {
          type: 'boolean',
          title: 'Cache Results',
          default: true,
          description: 'Cache calculated results to reduce InfluxDB queries'
        }
      }
    }
  }
};