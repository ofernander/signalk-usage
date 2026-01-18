# SignalK Usage Analytics

Analyze and report onboard usage of tanks, batteries, and energy sources from existing InfluxDB time-series data.

## Overview

This plugin **does not collect data** - it analyzes existing SignalK data that's already being written to InfluxDB by another plugin (like `signalk-to-influxdb2`). It calculates usage statistics over configurable time periods and exposes them via a REST API.

## Features

- 📊 Analyze any SignalK path stored in InfluxDB
- ⚡ Calculate energy consumption from power readings (Wh/kWh)
- 📉 Track volume consumed/added for tanks
- 🔋 Monitor battery charge/discharge cycles
- 🕐 Multiple time periods (15m, 1h, 24h, 7d, 30d, etc.)
- 🎯 Group multiple items for totals (e.g., total fuel from multiple tanks)
- 📡 Publish usage data back to SignalK
- 💾 Cached results for performance
- 🔌 REST API for integration with dashboards

## Prerequisites

**Required:**
- SignalK server
- InfluxDB 2.x instance
- `signalk-to-influxdb2` plugin (or similar) writing SignalK data to InfluxDB

**This plugin reads from InfluxDB - it does not write data.**

## Installation

1. Install via SignalK Appstore or:
```bash
cd ~/.signalk
npm install signalk-usage
```

2. Restart SignalK server

3. Configure the plugin

## Configuration

### InfluxDB Settings

Point to your **existing** InfluxDB instance:

- **URL**: InfluxDB instance URL (default: `http://localhost:8086`)
- **Token**: InfluxDB API token with **read** permissions
- **Organization**: InfluxDB organization name
- **Bucket**: Bucket where SignalK data is stored (usually `signalk`)
- **Measurement**: Measurement name (default: `signalk`)

### Usage Items

The plugin organizes items into two categories:

#### Tankage
For tracking tank levels (fuel, water, waste, etc.):

```json
{
  "path": "tanks.freshWater.0.remaining",
  "name": "Main Fresh Water",
  "unit": "m3",
  "capacity": 500,
  "enabled": true,
  "publish": true
}
```

#### Power
For tracking electrical power (batteries, solar, shore, etc.):

```json
{
  "path": "electrical.batteries.512.power",
  "name": "House Battery",
  "unit": "watts",
  "enabled": true,
  "publish": true
}
```

### Groups

Combine multiple items into totals:

```json
{
  "id": "totalFuel",
  "name": "Total Fuel Tanks",
  "type": "tankage",
  "paths": [
    "tanks.fuel.0.remaining",
    "tanks.fuel.1.remaining"
  ],
  "publish": true
}
```

### Publishing to SignalK

Enable publishing to send usage data back to SignalK:

```json
{
  "publishing": {
    "enabled": true,
    "updateInterval": 60,
    "periods": ["24h", "7d"]
  }
}

### Reporting Configuration

- **Time Periods**: Which periods to calculate (e.g., `["1h", "24h", "7d", "30d"]`)
- **Update Interval**: How often to recalculate (default: 60 seconds)
- **Cache Results**: Whether to cache calculations (default: true)

## Usage Calculations

### For Tanks (Volume)
- **Consumed**: How much was used (level decreased)
- **Added**: How much was added (level increased)
- **Rate**: Average consumption/addition rate

### For Batteries (State of Charge)
- **Discharged**: Amount of capacity used
- **Charged**: Amount of capacity added
- **Rate**: Average charge/discharge rate

### For Power (Watts)
- **Energy Consumed (Wh/kWh)**: Total energy consumed (using trapezoidal integration)
- **Energy Generated (Wh/kWh)**: Total energy generated
- **Average Power**: Average power draw/generation

## API

### Get All Usage Data
```
GET /plugins/signalk-usage/usage
```

Returns usage statistics for all configured items.

**Response:**
```json
{
  "timestamp": 1705363200000,
  "items": {
    "tanks.freshWater.0.remaining": {
      "path": "tanks.freshWater.0.remaining",
      "name": "Main Fresh Water",
      "unit": "m3",
      "type": "tank",
      "periods": {
        "7d": {
          "consumed": 0,
          "added": 342.4,
          "averageRate": 2.04
        }
      }
    }
  },
  "groups": {
    "totalFuel": {
      "id": "totalFuel",
      "name": "Total Fuel Tanks",
      "type": "tankage",
      "periods": {
        "24h": {
          "consumed": 45.5,
          "added": 0
        }
      }
    }
  }
}
```

### Get Usage for Specific Path
```
GET /plugins/signalk-usage/usage/tanks.freshWater.0.currentLevel
```

Returns usage data for a single path.

## Published SignalK Paths

When publishing is enabled, usage data is published to SignalK:

### Individual Items

**Tankage:**
- `usage.tanks.fuel.0.consumed.24h` - Volume consumed in last 24 hours
- `usage.tanks.fuel.0.added.24h` - Volume added in last 24 hours
- `usage.tanks.fuel.0.rate.24h` - Average consumption/addition rate

**Power:**
- `usage.electrical.batteries.512.consumedKwh.24h` - Energy consumed (kWh)
- `usage.electrical.batteries.512.generatedKwh.24h` - Energy generated (kWh)

### Groups

- `usage.groups.totalFuel.consumed.24h` - Total consumed across all tanks in group
- `usage.groups.totalFuel.added.24h` - Total added across all tanks in group

## How It Works

1. **Every X seconds** (configurable), the plugin queries InfluxDB for each configured path
2. For each time period (1h, 24h, etc.):
   - Gets first and last values in the period
   - Calculates delta (change)
   - For power: integrates to calculate total energy (Wh)
3. Results are **cached** to minimize InfluxDB queries
4. Data is available via REST API for dashboards/integrations

## Example Use Cases

### Daily Freshwater Consumption
Track how many liters of freshwater you use per day on average.

### Battery Energy Budget
Calculate total kWh consumed from batteries over the last 24 hours.

### Solar Generation Tracking
Monitor how much energy your solar panels generated this week.

### Fuel Consumption Rate
Track fuel usage rate over different cruising periods.

## Integration with Dashboards

Use the REST API to build custom dashboards:

```javascript
// Fetch usage data
fetch('/plugins/signalk-usage/usage')
  .then(res => res.json())
  .then(data => {
    const battery = data.items['electrical.batteries.512.power'];
    const energyToday = battery.periods['24h'].energy.consumedKwh;
    console.log(`Energy consumed today: ${energyToday} kWh`);
  });
```

## Troubleshooting

**No data in API response:**
- Check that InfluxDB bucket/measurement names match your signalk-to-influxdb2 configuration
- Verify paths exist in InfluxDB
- Check plugin logs for errors

**"No data available" errors:**
- Ensure data exists in InfluxDB for the requested time period
- Check that signalk-to-influxdb2 is running and writing data

**High CPU usage:**
- Increase update interval (reduce calculation frequency)
- Reduce number of time periods
- Ensure caching is enabled

## Development

```bash
git clone https://github.com/yourusername/signalk-usage.git
cd signalk-usage
npm install

# Link for testing
cd ~/.signalk/node_modules
ln -s /path/to/signalk-usage .
```

## Future Enhancements

- [ ] Web UI dashboard
- [ ] WebSocket streaming updates
- [ ] Alerts/notifications
- [ ] Export reports (CSV, PDF)
- [ ] Compare periods (this week vs last week)
- [ ] Predictive analytics (estimate remaining time)

## License

MIT

## Contributing

Pull requests welcome! Please open an issue first to discuss major changes.