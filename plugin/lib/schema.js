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
      description: 'Track tank levels (fuel, water, waste, etc.)',
      default: [],
      items: {
        type: 'object',
        required: ['path', 'periods'],
        properties: {
          path: {
            type: 'string',
            title: 'SignalK Path',
            description: 'Full path to tank level (e.g., tanks.freshWater.0.remaining)'
          },
          name: {
            type: 'string',
            title: 'Display Name (optional)',
            description: 'Human-readable name. Will be used in usage path (e.g., "fresh-water" becomes usage.fresh-water.*). Defaults to full SignalK path if not specified.'
          },
          capacity: {
            type: 'number',
            title: 'Capacity (optional)',
            description: 'Total capacity in the specified units'
          },
          periods: {
            type: 'array',
            title: 'Time Periods',
            description: 'Time periods to track for this specific tank. Each period has a range and aggregation window.',
            default: [
              { range: '1h', aggregation: '1m' },
              { range: '24h', aggregation: '3m' },
              { range: '7d', aggregation: '5h' }
            ],
            items: {
              type: 'object',
              required: ['range', 'aggregation'],
              properties: {
                range: {
                  type: 'string',
                  title: 'Time Range',
                  description: 'How far back to look. Examples: 1h, 24h, 7d, 30d, 365d'
                },
                aggregation: {
                  type: 'string',
                  title: 'Aggregation Window',
                  description: 'How to group data points. Smaller = more detail. Examples: 1m, 15m, 1h, 6h, 1d'
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
      description: 'Track power sources and loads (batteries, solar, shore, etc.)',
      default: [],
      items: {
        type: 'object',
        required: ['path', 'periods'],
        properties: {
          path: {
            type: 'string',
            title: 'SignalK Path',
            description: 'Full path to power measurement (e.g., electrical.batteries.512.power)'
          },
          name: {
            type: 'string',
            title: 'Display Name (optional)',
            description: 'Human-readable name. Will be used in usage path (e.g., "shore-power" becomes usage.shore-power.*). Defaults to full SignalK path if not specified.'
          },
          directionality: {
            type: 'string',
            title: 'Energy Flow Direction',
            enum: ['producer', 'consumer', 'bidirectional-normal', 'bidirectional-reversed'],
            description: 'How to interpret power sign: producer (solar/alternator - only generates), consumer (shore/loads - only consumes), bidirectional-normal (positive=generation, negative=consumption), bidirectional-reversed (positive=consumption, negative=generation, e.g. batteries). Leave blank for auto-detection.'
          },
          periods: {
            type: 'array',
            title: 'Time Periods',
            description: 'Time periods to track for this specific power source. Each period has a range and aggregation window.',
            default: [
              { range: '1h', aggregation: '1m' },
              { range: '24h', aggregation: '3m' },
              { range: '7d', aggregation: '5h' }
            ],
            items: {
              type: 'object',
              required: ['range', 'aggregation'],
              properties: {
                range: {
                  type: 'string',
                  title: 'Time Range',
                  description: 'How far back to look. Examples: 1h, 24h, 7d, 30d, 365d'
                },
                aggregation: {
                  type: 'string',
                  title: 'Aggregation Window',
                  description: 'How to group data points. Smaller = more detail. Examples: 30s, 1m, 15m, 1h, 6h, 1d'
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
    groups: {
      type: 'array',
      title: 'Usage Groups',
      description: 'Combine multiple items into totals (e.g., total fuel from multiple tanks)',
      default: [],
      items: {
        type: 'object',
        required: ['id', 'name', 'type', 'paths'],
        properties: {
          id: {
            type: 'string',
            title: 'Group ID',
            description: 'Unique identifier for this group (e.g., totalFuel)'
          },
          name: {
            type: 'string',
            title: 'Display Name',
            description: 'Human-readable name (e.g., "Total Fuel Tanks")'
          },
          type: {
            type: 'string',
            title: 'Group Type',
            enum: ['tankage', 'power'],
            description: 'Type of items being grouped'
          },
          paths: {
            type: 'array',
            title: 'Paths to Include',
            description: 'List of paths to sum together',
            items: {
              type: 'string'
            }
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
          description: 'How often to recalculate and publish usage statistics'
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