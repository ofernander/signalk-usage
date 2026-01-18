# signalk-usage

Uses infuxDB data to caculate tank and electrical usage

## Dependencies

- SignalK server with signalk-to-influxdb2 plugin
- InfluxDB 2.x 

## Installation

Install via SignalK Appstore or:
```bash
cd ~/.signalk
npm install signalk-usage
```

Configure InfluxDB connection and paths in plugin settings, then restart SignalK.