// UI Helper Functions
const UI = {
    // Update status indicator
    updateStatus(text, status) {
        const indicator = document.querySelector('.status-indicator');
        const dot = indicator.querySelector('.status-dot');
        const statusText = indicator.querySelector('.status-text');
        
        statusText.textContent = text;
        dot.className = 'status-dot';
        
        if (status === 'online') {
            dot.classList.add('online');
        } else if (status === 'offline') {
            dot.classList.add('offline');
        }
    },

    // Show loading state
    showLoading(elementId, message = 'Loading') {
        const element = document.getElementById(elementId);
        if (element) {
            element.innerHTML = `<div class="loading">${message}</div>`;
        }
    },

    // Show error message
    showError(elementId, message) {
        const element = document.getElementById(elementId);
        if (element) {
            element.innerHTML = `<div class="message error">${message}</div>`;
        }
    },

    // Show empty state
    showEmpty(elementId, message) {
        const element = document.getElementById(elementId);
        if (element) {
            element.innerHTML = `<div class="empty-state"><p>${message}</p></div>`;
        }
    },

    // Format energy (Wh to kWh if needed) with dynamic decimal places
    formatEnergy(wh) {
        // If value is truly zero, show it
        if (wh === 0) return '0.00 Wh';
        
        if (Math.abs(wh) >= 1000) {
            const kwh = wh / 1000;
            // Dynamic decimal places for kWh
            if (Math.abs(kwh) < 0.0001) return `< 0.0001 kWh`;
            if (Math.abs(kwh) < 0.01) return `${kwh.toFixed(4)} kWh`;
            if (Math.abs(kwh) < 0.1) return `${kwh.toFixed(3)} kWh`;
            if (Math.abs(kwh) < 1) return `${kwh.toFixed(2)} kWh`;
            if (Math.abs(kwh) < 10) return `${kwh.toFixed(2)} kWh`;
            return `${kwh.toFixed(1)} kWh`;
        }
        // Dynamic decimal places for Wh
        if (Math.abs(wh) < 0.0001) return `< 0.0001 Wh`;
        if (Math.abs(wh) < 0.01) return `${wh.toFixed(4)} Wh`;
        if (Math.abs(wh) < 0.1) return `${wh.toFixed(3)} Wh`;
        if (Math.abs(wh) < 1) return `${wh.toFixed(2)} Wh`;
        if (Math.abs(wh) < 10) return `${wh.toFixed(2)} Wh`;
        return `${wh.toFixed(1)} Wh`;
    },

    // Format power (W to kW if needed) with dynamic decimal places
    formatPower(watts) {
        // If value is truly zero, show it
        if (watts === 0) return '0.0 W';
        
        if (Math.abs(watts) >= 1000) {
            const kw = watts / 1000;
            // Dynamic decimal places for kW
            if (Math.abs(kw) < 0.001) return `< 0.001 kW`;
            if (Math.abs(kw) < 0.01) return `${kw.toFixed(3)} kW`;
            if (Math.abs(kw) < 0.1) return `${kw.toFixed(2)} kW`;
            if (Math.abs(kw) < 1) return `${kw.toFixed(2)} kW`;
            if (Math.abs(kw) < 10) return `${kw.toFixed(2)} kW`;
            return `${kw.toFixed(1)} kW`;
        }
        // Dynamic decimal places for W
        if (Math.abs(watts) < 0.001) return `< 0.001 W`;
        if (Math.abs(watts) < 0.1) return `${watts.toFixed(3)} W`;
        if (Math.abs(watts) < 1) return `${watts.toFixed(2)} W`;
        if (Math.abs(watts) < 10) return `${watts.toFixed(1)} W`;
        return `${watts.toFixed(0)} W`;
    },

    // Format volume with unit preference and dynamic decimal places
    formatVolume(m3, unitPref = 'metric') {
        if (unitPref === 'imperial') {
            // Convert m³ to gallons (1 m³ = 264.172 gallons)
            const gallons = m3 * 264.172;
            
            // If value is truly zero, show it
            if (gallons === 0) return '0.00 gal';
            
            // Dynamic decimal places based on magnitude
            // Never show 0.0000 for non-zero values - use scientific notation or "< 0.0001"
            if (Math.abs(gallons) < 0.0001) return `< 0.0001 gal`;
            if (Math.abs(gallons) < 0.01) return `${gallons.toFixed(4)} gal`;
            if (Math.abs(gallons) < 0.1) return `${gallons.toFixed(3)} gal`;
            if (Math.abs(gallons) < 1) return `${gallons.toFixed(2)} gal`;
            if (Math.abs(gallons) < 10) return `${gallons.toFixed(2)} gal`;
            return `${gallons.toFixed(1)} gal`;
        } else {
            // Convert m³ to liters (1 m³ = 1000 L)
            const liters = m3 * 1000;
            
            // If value is truly zero, show it
            if (liters === 0) return '0.00 L';
            
            // Dynamic decimal places based on magnitude
            // Never show 0.0000 for non-zero values - use "< 0.0001"
            if (Math.abs(liters) < 0.0001) return `< 0.0001 L`;
            if (Math.abs(liters) < 0.01) return `${liters.toFixed(4)} L`;
            if (Math.abs(liters) < 0.1) return `${liters.toFixed(3)} L`;
            if (Math.abs(liters) < 1) return `${liters.toFixed(2)} L`;
            if (Math.abs(liters) < 10) return `${liters.toFixed(2)} L`;
            return `${liters.toFixed(1)} L`;
        }
    },

    // Format time range
    formatTimeRange(start, end) {
        if (!start || !end) return 'N/A';
        const duration = (new Date(end) - new Date(start)) / (1000 * 60 * 60);
        return `${duration.toFixed(1)}h`;
    },

    // Format duration
    formatDuration(start, end) {
        const ms = new Date(end) - new Date(start);
        const hours = Math.floor(ms / (1000 * 60 * 60));
        const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
        return `${hours}h ${minutes}m`;
    },

    // Format datetime for input
    formatDateTimeLocal(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    },

    // Escape HTML
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // Get directionality class
    getDirectionalityClass(directionality) {
        if (!directionality) return 'bidirectional';
        const d = directionality.toLowerCase();
        if (d.includes('producer')) return 'producer';
        if (d.includes('consumer')) return 'consumer';
        return 'bidirectional';
    },

    // Format directionality for display
    formatDirectionality(directionality) {
        if (!directionality) return 'Bidirectional';
        const d = directionality.toLowerCase();
        if (d.includes('producer')) return 'Producer';
        if (d.includes('consumer')) return 'Consumer';
        return 'Bidirectional';
    },

    // Render stat card
    renderStatCard(path, item, isPower, unitPref = 'metric') {
        const directionality = item.directionality || 'bidirectional';
        const badgeClass = this.getDirectionalityClass(directionality);
        const badgeText = this.formatDirectionality(directionality);
        
        // Build title: always show path, add display name if different
        let title = this.escapeHtml(path);
        if (item.name && item.name !== path) {
            title = `${this.escapeHtml(path)} <span style="color: var(--text-muted); font-weight: normal;">(${this.escapeHtml(item.name)})</span>`;
        }
        
        let html = `
            <div class="stat-card">
                <div class="stat-header">
                    <div class="stat-title">${title}</div>
        `;
        
        if (isPower) {
            html += `<div class="stat-badge ${badgeClass}">${badgeText}</div>`;
        }
        
        html += `
                </div>
                ${this.renderPeriods(item.periods, isPower, unitPref, directionality, path)}
            </div>
        `;
        
        return html;
    },

    // Render periods
    renderPeriods(periods, isPower, unitPref = 'metric', directionality = 'bidirectional', path = '') {
        if (!periods) {
            return '<div class="insufficient-data">No period data available</div>';
        }

        return Object.entries(periods).map(([range, data]) => {
            if (data.insufficientData) {
                return `
                    <div class="period-stats">
                        <div class="period-label">${range}</div>
                        <div class="insufficient-data">⚠️ ${data.reason || 'Insufficient data'}</div>
                    </div>
                `;
            }

            return `
                <div class="period-stats">
                    <div class="period-label">${range}</div>
                    ${isPower ? this.renderPowerPeriod(data, directionality, path) : this.renderTankagePeriod(data, unitPref)}
                </div>
            `;
        }).join('');
    },

    // Render power period - conditionally show metrics based on directionality
    renderPowerPeriod(data, directionality = 'bidirectional', path = '') {
        const consumed = data.energy?.consumedWh || 0;
        const generated = data.energy?.generatedWh || 0;
        
        // Detect if this is a battery for terminology
        const isBattery = path.toLowerCase().includes('battery') || path.toLowerCase().includes('batteries');
        const consumedLabel = isBattery ? 'Discharged:' : 'Consumed:';
        const generatedLabel = isBattery ? 'Charged:' : 'Generated:';
        
        let html = '';
        
        // Show consumed for consumers and bidirectional
        if (directionality === 'consumer' || directionality === 'bidirectional') {
            html += `
                <div class="stat-row">
                    <span class="stat-label">${consumedLabel}</span>
                    <span class="stat-value negative">${this.formatEnergy(consumed)}</span>
                </div>
            `;
        }
        
        // Show generated for producers and bidirectional
        if (directionality === 'producer' || directionality === 'bidirectional') {
            html += `
                <div class="stat-row">
                    <span class="stat-label">${generatedLabel}</span>
                    <span class="stat-value positive">${this.formatEnergy(generated)}</span>
                </div>
            `;
        }
        
        // Only show net for bidirectional (it's redundant for unidirectional)
        if (directionality === 'bidirectional') {
            html += `
                <div class="stat-row">
                    <span class="stat-label">Net:</span>
                    <span class="stat-value">${this.formatEnergy(generated - consumed)}</span>
                </div>
            `;
        }
        
        return html;
    },

    // Render tankage period - simplified to consumption only
    renderTankagePeriod(data, unitPref = 'metric') {
        const consumed = data.consumed || 0;
        const added = data.added || 0;
        const change = added - consumed; // Net change
        
        return `
            <div class="stat-row">
                <span class="stat-label">Consumed:</span>
                <span class="stat-value negative">${this.formatVolume(consumed, unitPref)}</span>
            </div>
        `;
    },

    // Render query results
    renderQueryResults(results, path) {
        if (!results || !results.data || results.data.length === 0) {
            return '<div class="empty-state">No data found for the selected time range</div>';
        }

        const data = results.data;
        const duration = this.formatDuration(results.start, results.end);
        const dataPoints = data.length;

        let summaryHtml = `
            <div class="query-summary">
                <div class="summary-item">
                    <div class="summary-label">Time Range</div>
                    <div class="summary-value">${new Date(results.start).toLocaleString()} to ${new Date(results.end).toLocaleString()}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">Duration</div>
                    <div class="summary-value">${duration}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">Data Points</div>
                    <div class="summary-value">${dataPoints}</div>
                </div>
        `;

        // Show energy totals for power items
        if (results.energy) {
            const consumed = results.energy.consumedWh || 0;
            const generated = results.energy.generatedWh || 0;
            const net = generated - consumed;
            
            if (consumed > 0) {
                summaryHtml += `
                    <div class="summary-item">
                        <div class="summary-label">Total Consumed</div>
                        <div class="summary-value negative">${this.formatEnergy(consumed)}</div>
                    </div>
                `;
            }
            if (generated > 0) {
                summaryHtml += `
                    <div class="summary-item">
                        <div class="summary-label">Total Generated</div>
                        <div class="summary-value positive">${this.formatEnergy(generated)}</div>
                    </div>
                `;
            }
            if (consumed > 0 || generated > 0) {
                summaryHtml += `
                    <div class="summary-item">
                        <div class="summary-label">Net Energy</div>
                        <div class="summary-value">${this.formatEnergy(net)}</div>
                    </div>
                `;
            }
        }
        
        // Show volume change for tankage items (calculate from first to last)
        if (results.type === 'tankage' && data.length >= 2) {
            const firstValue = data[0].value;
            const lastValue = data[data.length - 1].value;
            const netChange = lastValue - firstValue;
            
            summaryHtml += `
                <div class="summary-item">
                    <div class="summary-label">Net Change</div>
                    <div class="summary-value ${netChange < 0 ? 'negative' : 'positive'}">${this.formatVolume(netChange, app.unitPreference)}</div>
                </div>
            `;
            
            if (netChange < 0) {
                summaryHtml += `
                    <div class="summary-item">
                        <div class="summary-label">Total Consumed</div>
                        <div class="summary-value negative">${this.formatVolume(Math.abs(netChange), app.unitPreference)}</div>
                    </div>
                `;
            } else if (netChange > 0) {
                summaryHtml += `
                    <div class="summary-item">
                        <div class="summary-label">Total Added</div>
                        <div class="summary-value positive">${this.formatVolume(netChange, app.unitPreference)}</div>
                    </div>
                `;
            }
        }

        summaryHtml += `</div>`;

        return summaryHtml;
    }
};