/**
 * SignalK Usage - Main Application
 * 
 * Uses WebSocket to subscribe to published usage deltas
 */
class UsageApp {
    constructor() {
        this.currentData = {
            power: {},
            tankage: {}
        };
        this.config = {
            power: [],
            tankage: [],
            reporting: {}
        };
        this.chart = null;
        this.ws = null;
        this.unitPreference = 'metric'; // Default, will be overridden from config
        this.renderScheduled = false; // Throttle rendering
        this.init();
    }

    init() {
        this.setupTabs();
        this.setupEventListeners();
        this.setDefaultDateTimes();
        
        // Load config first, then connect WebSocket
        this.loadConfiguration().then(() => {
            this.ws = new WebSocketManager(this);
            this.ws.connect();
        });
    }

    async loadConfiguration() {
        try {
            const response = await fetch('/plugins/signalk-usage/api/config');
            if (!response.ok) throw new Error('Failed to load configuration');
            
            this.config = await response.json();
            
            // Get unit preference from config
            this.unitPreference = this.config.reporting?.unitPreference || 'metric';
            
            console.log('Configuration loaded:', this.config);
            console.log('Unit preference:', this.unitPreference);
            
        } catch (error) {
            console.error('Error loading configuration:', error);
        }
    }

    // WebSocket callbacks
    onWebSocketConnected() {
        UI.updateStatus('Connected', 'online');
    }

    onWebSocketDisconnected() {
        UI.updateStatus('Disconnected', 'offline');
    }

    onUsageUpdate(path, value) {
        console.log('Delta received:', path, value); // DEBUG
        
        // Parse the path: usage.electrical.batteries.512.power.consumedWh.1h
        // Format: usage.<originalPath>.<metric>.<period>
        
        const parts = path.split('.');
        if (parts.length < 3) return;

        // Remove 'usage.' prefix
        parts.shift();

        // Last two parts are metric and period
        const period = parts.pop();
        const metric = parts.pop();
        
        // Rest is the original path
        const originalPath = parts.join('.');

        // Determine if it's power or tankage
        const isPower = metric.includes('Wh') || 
                       metric.includes('charged') || 
                       metric.includes('discharged');
        const category = isPower ? 'power' : 'tankage';

        // Get config for this item
        const itemConfig = this.findItemConfig(originalPath, category);

        // Initialize item if it doesn't exist
        if (!this.currentData[category][originalPath]) {
            this.currentData[category][originalPath] = {
                path: originalPath,
                name: itemConfig ? itemConfig.name : originalPath,
                directionality: itemConfig ? itemConfig.directionality : 'bidirectional',
                periods: {},
                unit: isPower ? 'watts' : 'm3'
            };
        }

        // Update directionality if we have config
        if (itemConfig && itemConfig.directionality) {
            this.currentData[category][originalPath].directionality = itemConfig.directionality;
        }

        // Initialize period if it doesn't exist
        if (!this.currentData[category][originalPath].periods[period]) {
            this.currentData[category][originalPath].periods[period] = {
                period: period
            };
        }

        // Store the metric value
        if (isPower) {
            if (metric === 'consumedWh' || metric === 'dischargedWh') {
                this.currentData[category][originalPath].periods[period].energy = 
                    this.currentData[category][originalPath].periods[period].energy || {};
                this.currentData[category][originalPath].periods[period].energy.consumedWh = value;
            } else if (metric === 'generatedWh' || metric === 'chargedWh') {
                this.currentData[category][originalPath].periods[period].energy = 
                    this.currentData[category][originalPath].periods[period].energy || {};
                this.currentData[category][originalPath].periods[period].energy.generatedWh = value;
            }
        } else {
            // Tankage metrics
            if (metric === 'consumed') {
                this.currentData[category][originalPath].periods[period].consumed = value;
            } else if (metric === 'added') {
                this.currentData[category][originalPath].periods[period].added = value;
            }
        }

        // Schedule a UI update (throttled to max once per second)
        this.scheduleRender();
    }

    scheduleRender() {
        if (this.renderScheduled) return;
        
        console.log('Scheduling render...'); // DEBUG
        this.renderScheduled = true;
        requestAnimationFrame(() => {
            console.log('Rendering dashboard now'); // DEBUG
            this.renderDashboard();
            this.renderScheduled = false;
        });
    }

    findItemConfig(path, category) {
        const items = this.config[category] || [];
        return items.find(item => item.path === path);
    }

    setupTabs() {
        const tabs = document.querySelectorAll('.tab');
        const tabContents = document.querySelectorAll('.tab-content');
        
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetTab = tab.dataset.tab;
                
                tabs.forEach(t => t.classList.remove('active'));
                tabContents.forEach(c => c.classList.remove('active'));
                
                tab.classList.add('active');
                document.getElementById(targetTab).classList.add('active');
            });
        });
    }

    setupEventListeners() {
        // Query form
        const queryForm = document.getElementById('queryForm');
        queryForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.runCustomQuery();
        });

        // Query type change
        document.getElementById('queryType').addEventListener('change', () => {
            this.updatePathOptions();
        });

        // Quick range buttons
        document.querySelectorAll('.quick-ranges .btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.applyQuickRange(btn.dataset.range);
            });
        });
    }

    renderDashboard() {
        this.renderPowerStats(this.currentData.power);
        this.renderTankageStats(this.currentData.tankage);
        
        // Update path options for custom query after data is loaded
        this.updatePathOptions();
    }

    renderPowerStats(items) {
        const container = document.getElementById('powerStats');
        
        if (Object.keys(items).length === 0) {
            UI.showEmpty('powerStats', 'No power items configured. Waiting for data...');
            return;
        }

        container.innerHTML = Object.entries(items)
            .sort(([pathA], [pathB]) => pathA.localeCompare(pathB)) // Sort alphabetically by path
            .map(([path, item]) => UI.renderStatCard(path, item, true, this.unitPreference))
            .join('');
    }

    renderTankageStats(items) {
        const container = document.getElementById('tankageStats');
        
        if (Object.keys(items).length === 0) {
            UI.showEmpty('tankageStats', 'No tankage items configured. Waiting for data...');
            return;
        }

        container.innerHTML = Object.entries(items)
            .sort(([pathA], [pathB]) => pathA.localeCompare(pathB)) // Sort alphabetically by path
            .map(([path, item]) => UI.renderStatCard(path, item, false, this.unitPreference))
            .join('');
    }

    updatePathOptions() {
        const select = document.getElementById('queryPath');
        const type = document.getElementById('queryType').value;
        
        const items = type === 'power' ? this.currentData.power : this.currentData.tankage;

        if (Object.keys(items).length === 0) {
            select.innerHTML = '<option value="">No items configured</option>';
            return;
        }

        const options = Object.entries(items)
            .map(([path, item]) => 
                `<option value="${path}">${UI.escapeHtml(item.name || path)}</option>`
            );

        select.innerHTML = '<option value="">Select a path...</option>' + options.join('');
    }

    setDefaultDateTimes() {
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        
        // Set times to midnight (00:00)
        now.setHours(0, 0, 0, 0);
        yesterday.setHours(0, 0, 0, 0);
        
        document.getElementById('endDate').value = UI.formatDateTimeLocal(now);
        document.getElementById('startDate').value = UI.formatDateTimeLocal(yesterday);
    }

    applyQuickRange(range) {
        const now = new Date();
        const start = new Date(now);
        
        const match = range.match(/^(\d+)([smhd])$/);
        if (match) {
            const value = parseInt(match[1]);
            const unit = match[2];
            
            switch (unit) {
                case 's': start.setSeconds(start.getSeconds() - value); break;
                case 'm': start.setMinutes(start.getMinutes() - value); break;
                case 'h': start.setHours(start.getHours() - value); break;
                case 'd': start.setDate(start.getDate() - value); break;
            }
        }
        
        document.getElementById('startDate').value = UI.formatDateTimeLocal(start);
        document.getElementById('endDate').value = UI.formatDateTimeLocal(now);
    }

    async runCustomQuery() {
        const path = document.getElementById('queryPath').value;
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        const aggregation = document.getElementById('aggregation').value;
        
        if (!path) {
            alert('Please select a path');
            return;
        }
        
        if (!startDate || !endDate) {
            alert('Please select start and end dates');
            return;
        }

        const submitBtn = document.querySelector('#queryForm button[type="submit"]');
        submitBtn.disabled = true;

        try {
            const start = new Date(startDate).toISOString();
            const end = new Date(endDate).toISOString();
            
            const response = await fetch('/plugins/signalk-usage/api/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, start, end, aggregation })
            });

            if (!response.ok) throw new Error('Query failed');
            
            const results = await response.json();
            this.displayQueryResults(results, path);
            
        } catch (error) {
            console.error('Query error:', error);
            alert('Query failed: ' + error.message);
        } finally {
            submitBtn.disabled = false;
        }
    }

    displayQueryResults(results, path) {
        const resultsDiv = document.getElementById('queryResults');
        const contentDiv = document.getElementById('queryResultsContent');
        
        resultsDiv.style.display = 'block';
        
        contentDiv.innerHTML = UI.renderQueryResults(results, path);
        this.updateChart(results);
        
        resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    updateChart(results) {
        const canvas = document.getElementById('chartCanvas');
        const ctx = canvas.getContext('2d');

        if (this.chart) {
            this.chart.destroy();
        }

        const data = results.data || [];
        const labels = data.map(d => new Date(d.timestamp).toLocaleString());
        
        // Convert values based on type and unit preference
        let values, unitLabel;
        if (results.type === 'power') {
            // Power values are already in Watts, no conversion needed
            values = data.map(d => d.value);
            unitLabel = 'W';
        } else {
            // Tankage values in m³ - convert to L or gal
            if (this.unitPreference === 'imperial') {
                // Convert m³ to gallons (1 m³ = 264.172 gal)
                values = data.map(d => d.value * 264.172);
                unitLabel = 'gal';
            } else {
                // Convert m³ to liters (1 m³ = 1000 L)
                values = data.map(d => d.value * 1000);
                unitLabel = 'L';
            }
        }

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: `Value (${unitLabel})`,
                    data: values,
                    borderColor: '#2c5282',
                    backgroundColor: 'rgba(44, 82, 130, 0.1)',
                    tension: 0.1,
                    fill: true,
                    pointRadius: 2,
                    pointHoverRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        backgroundColor: 'rgba(44, 82, 130, 0.9)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        borderColor: '#2c5282',
                        borderWidth: 1
                    }
                },
                scales: {
                    x: {
                        display: true,
                        ticks: {
                            maxRotation: 45,
                            minRotation: 45,
                            autoSkip: true,
                            maxTicksLimit: 10
                        },
                        grid: {
                            color: '#e2e8f0'
                        }
                    },
                    y: {
                        display: true,
                        beginAtZero: false,
                        grid: {
                            color: '#e2e8f0'
                        }
                    }
                },
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                }
            }
        });
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new UsageApp();
});