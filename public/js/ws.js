/**
 * SignalK Usage - WebSocket Manager
 * 
 * Subscribes to usage delta updates from SignalK
 */
class WebSocketManager {
    constructor(app) {
        this.app = app;
        this.ws = null;
        this.reconnectTimer = null;
        this.subscriptions = [];
    }

    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}/signalk/v1/stream?subscribe=none`;

        console.log('Connecting to SignalK WebSocket:', wsUrl);

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.app.onWebSocketConnected();
            this.subscribeToUsageData();
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            this.app.onWebSocketDisconnected();
            this.scheduleReconnect();
        };
    }

    subscribeToUsageData() {
        // Subscribe to all usage paths
        const subscription = {
            context: 'vessels.self',
            subscribe: [
                {
                    path: 'usage.*',
                    period: 1000,
                    minPeriod: 1000
                }
            ]
        };

        this.send(subscription);
        console.log('Subscribed to usage.* paths');
    }

    handleMessage(data) {
        if (!data.updates) return;

        data.updates.forEach(update => {
            if (!update.values) return;

            update.values.forEach(pathValue => {
                if (pathValue.path && pathValue.path.startsWith('usage.')) {
                    this.app.onUsageUpdate(pathValue.path, pathValue.value);
                }
            });
        });
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    scheduleReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        this.reconnectTimer = setTimeout(() => {
            console.log('Attempting to reconnect WebSocket...');
            this.connect();
        }, 5000);
    }

    disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}