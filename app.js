// Global state
let trailData = [];
let checkpoints = [];
let currentUnit = 'imperial'; // 'imperial' or 'metric'
let currentTheme = 'topo';   // 'topo', 'satellite', 'street'
let map, elevationChart, trailLine, trackingMarker, activeMarkerHighlight;
let mapLayers = {};

// Checkpoint raw data coordinates on ascent (approximate matching)
const checkpointConfigs = [
    { name: "Whitney Portal", lat: 36.58688, lng: -118.24014, emoji: "🏁", desc: "Trailhead & parking lot" },
    { name: "Lone Pine Lake Jct", lat: 36.578368, lng: -118.251515, emoji: "🌲", desc: "Short side trail to lake" },
    { name: "Outpost Camp", lat: 36.572143, lng: -118.25954, emoji: "⛺", desc: "Sheltered campsite by waterfall" },
    { name: "Trail Camp", lat: 36.563394, lng: -118.277547, emoji: "⛺", desc: "High camp, last water source" },
    { name: "Trail Crest", lat: 36.558859, lng: -118.290297, emoji: "⛰️", desc: "High pass, junction with JMT" },
    { name: "Whitney Summit", lat: 36.578545, lng: -118.292241, emoji: "🏔️", desc: "Highest peak in Lower 48" }
];

// Document ready
document.addEventListener("DOMContentLoaded", () => {
    loadTrailData();
    setupUnitToggle();
    setupMapThemes();
    setupPrepGuide();
});

// Parse the CSV
function loadTrailData() {
    Papa.parse("Mount_Whitney_Trail.csv", {
        download: true,
        header: true,
        dynamicTyping: true,
        complete: function(results) {
            parseCSVData(results.data);
            calculateCheckpoints();
            initDashboard();
            hideLoading();
        },
        error: function(err) {
            console.error("Error reading CSV file:", err);
            document.querySelector('.loading-text').innerText = "Failed to load trail data. Make sure server is running.";
        }
    });
}

// Convert CSV rows into structured objects
function parseCSVData(rows) {
    trailData = rows.filter(row => row.Lat !== undefined && row.Lng !== undefined).map((row, idx) => {
        return {
            index: idx,
            lat: Number(row.Lat),
            lng: Number(row.Lng),
            distanceMeters: Number(row['Distance (meters)']),
            distanceMiles: Number(row['Distance (miles)']),
            elevationMeters: Number(row['Elevation (meters)']),
            elevationFeet: Number(row['Elevation (feet)']),
            slopeDegrees: Number(row['Slope (degrees)']) || 0,
            landcover: row.Landcover || 'Unknown',
            canopy: Number(row['Canopy (percent)']) || 0,
            linearGrade: Number(row['Linear Grade (percent)']) || 0
        };
    });
}

// Find closest data points in trailData to coordinate configs to populate checkpoint metrics
function calculateCheckpoints() {
    checkpoints = checkpointConfigs.map((config, index) => {
        // Find closest point in trailData by coordinates
        let minDistance = Infinity;
        let closestPoint = null;
        
        // Only search first half (ascent) for checkpoints to get clean ascent distances
        const searchBound = Math.floor(trailData.length / 2) + 10;
        for (let i = 0; i < searchBound && i < trailData.length; i++) {
            const p = trailData[i];
            const d = Math.pow(p.lat - config.lat, 2) + Math.pow(p.lng - config.lng, 2);
            if (d < minDistance) {
                minDistance = d;
                closestPoint = p;
            }
        }
        
        return {
            ...config,
            ...closestPoint,
            id: `checkpoint-${index}`
        };
    });
}

// Initialize Dashboard Map, Chart and Stats
function initDashboard() {
    calculateAndRenderStats();
    initMap();
    initChart();
    renderCheckpointsList();
}

function hideLoading() {
    const loader = document.getElementById('loading-overlay');
    loader.classList.add('hidden');
}

// Calculate Summary Statistics
function calculateAndRenderStats() {
    if (trailData.length === 0) return;
    
    // Find summit (highest point)
    const summitPoint = checkpoints[checkpoints.length - 1];
    
    // Total distance of out-and-back trail
    const totalDistMiles = trailData[trailData.length - 1].distanceMiles;
    const totalDistKm = trailData[trailData.length - 1].distanceMeters / 1000;
    
    // Peak elevation
    const peakElevFeet = summitPoint.elevationFeet;
    const peakElevMeters = summitPoint.elevationMeters;
    
    // Elevation Gain (calculate positive differences on ascent)
    const midIndex = summitPoint.index;
    let gainMeters = 0;
    for (let i = 1; i <= midIndex; i++) {
        let diff = trailData[i].elevationMeters - trailData[i-1].elevationMeters;
        if (diff > 0) {
            gainMeters += diff;
        }
    }
    const gainFeet = gainMeters * 3.28084;
    
    // Max Slope
    let maxSlope = 0;
    trailData.forEach(p => {
        if (p.slopeDegrees > maxSlope) {
            maxSlope = p.slopeDegrees;
        }
    });

    // Store in stats object
    window.stats = {
        totalDistMiles,
        totalDistKm,
        gainFeet,
        gainMeters,
        peakElevFeet,
        peakElevMeters,
        maxSlope
    };

    updateStatsDOM();
}

// Update stats numbers on screen based on units selection
function updateStatsDOM() {
    const stats = window.stats;
    if (!stats) return;
    
    if (currentUnit === 'imperial') {
        document.getElementById('stat-distance').innerText = stats.totalDistMiles.toFixed(2);
        document.getElementById('unit-dist').innerText = 'mi';
        
        document.getElementById('stat-elev-gain').innerText = Math.round(stats.gainFeet).toLocaleString();
        document.getElementById('unit-elev-gain').innerText = 'ft';
        
        document.getElementById('stat-max-elev').innerText = Math.round(stats.peakElevFeet).toLocaleString();
        document.getElementById('unit-elev-max').innerText = 'ft';
    } else {
        document.getElementById('stat-distance').innerText = stats.totalDistKm.toFixed(2);
        document.getElementById('unit-dist').innerText = 'km';
        
        document.getElementById('stat-elev-gain').innerText = Math.round(stats.gainMeters).toLocaleString();
        document.getElementById('unit-elev-gain').innerText = 'm';
        
        document.getElementById('stat-max-elev').innerText = Math.round(stats.peakElevMeters).toLocaleString();
        document.getElementById('unit-elev-max').innerText = 'm';
    }
    
    document.getElementById('stat-max-slope').innerText = Math.round(stats.maxSlope);
}

// Setup Interactive Map using Leaflet
function initMap() {
    // Center map around the middle of the trail
    const midPointIndex = Math.floor(trailData.length / 2);
    const midPoint = trailData[midPointIndex];
    
    map = L.map('map-container', {
        zoomControl: false,
        attributionControl: false
    }).setView([midPoint.lat, midPoint.lng], 12);
    
    // Add custom zoom control in top right
    L.control.zoom({
        position: 'topright'
    }).addTo(map);

    // Setup map tile layers
    mapLayers.street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
    });
    
    mapLayers.topoMeters = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17,
        attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)'
    });
    
    mapLayers.topoFeet = L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 16,
        attribution: 'Tiles courtesy of the U.S. Geological Survey'
    });
    
    mapLayers.satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19
    });
    
    // Load default Topographic layer based on unit
    updateActiveMapLayer();
    
    // Draw the trail line
    const pathCoordinates = trailData.map(p => [p.lat, p.lng]);
    
    // Main neon blue line with high opacity
    trailLine = L.polyline(pathCoordinates, {
        color: '#10b981',
        weight: 4,
        opacity: 0.9,
        lineJoin: 'round'
    }).addTo(map);
    
    // Fit map bounds to the trail
    map.fitBounds(trailLine.getBounds(), { padding: [30, 30] });
    
    // Add waypoint markers
    checkpoints.forEach((cp, idx) => {
        const customIcon = L.divIcon({
            className: 'custom-marker',
            html: `<div style="
                width: 32px;
                height: 32px;
                background: ${idx === checkpoints.length - 1 ? 'rgba(59, 130, 246, 0.95)' : 'rgba(17, 24, 39, 0.9)'};
                border: 2px solid ${idx === checkpoints.length - 1 ? '#3b82f6' : '#10b981'};
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 16px;
                box-shadow: 0 4px 10px rgba(0,0,0,0.5);
                transition: transform 0.2s ease;
                cursor: pointer;
            " class="marker-bubble" data-cp-id="${cp.id}">
                ${cp.emoji}
            </div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16],
            popupAnchor: [0, -16]
        });
        
        const popupContent = `
            <div style="font-family: var(--font-sans);">
                <h3>${cp.name}</h3>
                <p style="margin: 4px 0;">${cp.desc}</p>
                <p><strong>Distance:</strong> <span class="popup-dist" data-miles="${cp.distanceMiles}">${cp.distanceMiles.toFixed(2)} mi</span></p>
                <p><strong>Elevation:</strong> <span class="popup-elev" data-feet="${cp.elevationFeet}">${Math.round(cp.elevationFeet).toLocaleString()} ft</span></p>
            </div>
        `;
        
        const marker = L.marker([cp.lat, cp.lng], { icon: customIcon })
            .addTo(map)
            .bindPopup(popupContent);
            
        cp.marker = marker;
        
        // Bind marker hover / click triggers
        marker.on('click', () => {
            highlightCheckpointInSidebar(cp.id);
            syncChartHover(cp.index);
        });
    });

    // Tracking dot for chart hover synching
    trackingMarker = L.circleMarker([0, 0], {
        radius: 7,
        color: '#3b82f6',
        fillColor: '#ffffff',
        fillOpacity: 1,
        weight: 3,
        className: 'chart-tracking-dot'
    });
}

// Map layer theme toggle
function setupMapThemes() {
    const buttons = document.querySelectorAll('.map-theme-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const theme = btn.dataset.theme;
            currentTheme = theme;
            
            updateActiveMapLayer();
            
            // Update active states
            buttons.forEach(b => {
                b.classList.remove('active');
                b.querySelector('span:last-child').innerText = '';
            });
            btn.classList.add('active');
            btn.querySelector('span:last-child').innerText = '✓';
        });
    });
}

function updateActiveMapLayer() {
    if (!map) return;
    
    // Remove all layers
    Object.values(mapLayers).forEach(layer => {
        if (map.hasLayer(layer)) {
            map.removeLayer(layer);
        }
    });
    
    // Determine which layer to add
    let activeLayer;
    if (currentTheme === 'topo') {
        activeLayer = currentUnit === 'imperial' ? mapLayers.topoFeet : mapLayers.topoMeters;
    } else {
        activeLayer = mapLayers[currentTheme];
    }
    
    activeLayer.addTo(map);
}

// Generate interactive checkpoints items in the sidebar
function renderCheckpointsList() {
    const container = document.getElementById('checkpoint-container');
    container.innerHTML = '';
    
    checkpoints.forEach((cp, idx) => {
        const item = document.createElement('div');
        item.className = 'checkpoint-item';
        item.id = cp.id;
        
        const distStr = currentUnit === 'imperial' ? 
            `${cp.distanceMiles.toFixed(1)} mi` : 
            `${(cp.distanceMeters / 1000).toFixed(1)} km`;
            
        const elevStr = currentUnit === 'imperial' ? 
            `${Math.round(cp.elevationFeet).toLocaleString()} ft` : 
            `${Math.round(cp.elevationMeters).toLocaleString()} m`;
            
        item.innerHTML = `
            <div class="checkpoint-icon">${idx + 1}</div>
            <div class="checkpoint-details">
                <div class="checkpoint-name">${cp.name}</div>
                <div class="checkpoint-meta">
                    <span>📍 ${distStr}</span>
                    <span>⛰️ ${elevStr}</span>
                </div>
            </div>
            <div style="font-size: 14px; opacity: 0.8;">${cp.emoji}</div>
        `;
        
        item.addEventListener('click', () => {
            focusOnCheckpoint(cp);
        });
        
        container.appendChild(item);
    });
}

// Move map camera, highlight sidebar, open popup
function focusOnCheckpoint(cp) {
    // Zoom/pan map
    map.setView([cp.lat, cp.lng], 15);
    cp.marker.openPopup();
    
    highlightCheckpointInSidebar(cp.id);
    syncChartHover(cp.index);
}

function highlightCheckpointInSidebar(id) {
    document.querySelectorAll('.checkpoint-item').forEach(item => {
        item.classList.remove('active');
    });
    const activeItem = document.getElementById(id);
    if (activeItem) {
        activeItem.classList.add('active');
        activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// Chart.js initialization
function initChart() {
    const ctx = document.getElementById('elevationChart').getContext('2d');
    
    // Prepare chart labels (distance) and dataset (elevation)
    const labels = trailData.map(p => currentUnit === 'imperial' ? p.distanceMiles : p.distanceMeters / 1000);
    const elevData = trailData.map(p => currentUnit === 'imperial' ? p.elevationFeet : p.elevationMeters);
    
    // Beautiful gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, 'rgba(16, 185, 129, 0.4)');
    gradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

    elevationChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Elevation',
                data: elevData,
                borderColor: '#10b981',
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 6,
                pointHoverBackgroundColor: '#ffffff',
                pointHoverBorderColor: '#3b82f6',
                pointHoverBorderWidth: 3,
                fill: true,
                backgroundColor: gradient,
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: false // Custom overlay box handle tooltips
                }
            },
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: currentUnit === 'imperial' ? 'Distance (miles)' : 'Distance (kilometers)',
                        color: '#9ca3af',
                        font: { family: 'Plus Jakarta Sans', size: 10, weight: 600 }
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.04)', drawBorder: false },
                    ticks: {
                        color: '#9ca3af',
                        font: { family: 'Plus Jakarta Sans', size: 9 },
                        callback: function(val) { return Number(val).toFixed(1); }
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: currentUnit === 'imperial' ? 'Elevation (feet)' : 'Elevation (meters)',
                        color: '#9ca3af',
                        font: { family: 'Plus Jakarta Sans', size: 10, weight: 600 }
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.04)', drawBorder: false },
                    ticks: {
                        color: '#9ca3af',
                        font: { family: 'Plus Jakarta Sans', size: 9 },
                        callback: function(val) { return Math.round(val).toLocaleString(); }
                    }
                }
            },
            onHover: (event, chartElements) => {
                if (chartElements && chartElements.length > 0) {
                    const idx = chartElements[0].index;
                    syncMapHover(idx);
                } else {
                    hideMapHoverTracking();
                }
            }
        }
    });
}

// Chart hover updates map tracker dot
function syncMapHover(index) {
    const dataPoint = trailData[index];
    if (!dataPoint) return;
    
    // Position marker on map
    trackingMarker.setLatLng([dataPoint.lat, dataPoint.lng]);
    if (!map.hasLayer(trackingMarker)) {
        trackingMarker.addTo(map);
    }
    
    // Check if map container has zoomed to point or if marker is out of view
    // (Optional: pan map to coordinate if it falls completely off map bounds)
    
    // Update stats info box
    const infoBox = document.getElementById('hover-info-box');
    infoBox.classList.add('visible');
    
    const distStr = currentUnit === 'imperial' ? 
        `${dataPoint.distanceMiles.toFixed(2)} mi` : 
        `${(dataPoint.distanceMeters / 1000).toFixed(2)} km`;
        
    const elevStr = currentUnit === 'imperial' ? 
        `${Math.round(dataPoint.elevationFeet).toLocaleString()} ft` : 
        `${Math.round(dataPoint.elevationMeters).toLocaleString()} m`;
        
    document.getElementById('hover-dist').innerText = distStr;
    document.getElementById('hover-elev').innerText = elevStr;
    document.getElementById('hover-slope').innerText = `${Math.round(dataPoint.slopeDegrees)}°`;
    document.getElementById('hover-landcover').innerText = dataPoint.landcover;
}

function hideMapHoverTracking() {
    if (map && map.hasLayer(trackingMarker)) {
        map.removeLayer(trackingMarker);
    }
    const infoBox = document.getElementById('hover-info-box');
    if (infoBox) {
        infoBox.classList.remove('visible');
    }
}

// Waypoint marker click sets chart hover elements
function syncChartHover(index) {
    if (!elevationChart) return;
    
    // Highlight elements in chart
    elevationChart.setActiveElements([{
        datasetIndex: 0,
        index: index
    }]);
    elevationChart.update();
    
    // Trigger map update for it
    syncMapHover(index);
}

// Setup imperial/metric unit conversion toggles
function setupUnitToggle() {
    const buttons = document.querySelectorAll('#unit-toggle button');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const unit = btn.dataset.unit;
            if (unit === currentUnit) return;
            
            currentUnit = unit;
            
            // Toggle active styling
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Refresh stats numbers
            updateStatsDOM();
            
            // Re-render checkpoint list in sidebar
            renderCheckpointsList();
            
            // Update popups on map
            checkpoints.forEach(cp => {
                const distStr = currentUnit === 'imperial' ? 
                    `${cp.distanceMiles.toFixed(2)} mi` : 
                    `${(cp.distanceMeters / 1000).toFixed(2)} km`;
                    
                const elevStr = currentUnit === 'imperial' ? 
                    `${Math.round(cp.elevationFeet).toLocaleString()} ft` : 
                    `${Math.round(cp.elevationMeters).toLocaleString()} m`;
                    
                const popupContent = `
                    <div style="font-family: var(--font-sans);">
                        <h3>${cp.name}</h3>
                        <p style="margin: 4px 0;">${cp.desc}</p>
                        <p><strong>Distance:</strong> ${distStr}</p>
                        <p><strong>Elevation:</strong> ${elevStr}</p>
                    </div>
                `;
                cp.marker.setPopupContent(popupContent);
            });
            
            // Update chart units and axes titles
            if (elevationChart) {
                const labels = trailData.map(p => currentUnit === 'imperial' ? p.distanceMiles : p.distanceMeters / 1000);
                const elevData = trailData.map(p => currentUnit === 'imperial' ? p.elevationFeet : p.elevationMeters);
                
                elevationChart.data.labels = labels;
                elevationChart.data.datasets[0].data = elevData;
                
                elevationChart.options.scales.x.title.text = currentUnit === 'imperial' ? 'Distance (miles)' : 'Distance (kilometers)';
                elevationChart.options.scales.y.title.text = currentUnit === 'imperial' ? 'Elevation (feet)' : 'Elevation (meters)';
                
                elevationChart.update();
            }
            
            // Update Topo theme label in UI
            const topoLabel = document.getElementById('topo-btn-text');
            if (topoLabel) {
                topoLabel.innerText = currentUnit === 'imperial' ? '⛰️ Topo (Feet)' : '⛰️ Topo (Meters)';
            }
            
            // Update active layer if currently in topo mode
            updateActiveMapLayer();
        });
    });
}

// Setup Prep Guide Dialog and checklist local storage sync
function setupPrepGuide() {
    const prepBtn = document.getElementById('prep-btn');
    const prepDialog = document.getElementById('prep-dialog');
    const closeDialogBtn = document.getElementById('close-dialog-btn');
    
    if (!prepBtn || !prepDialog || !closeDialogBtn) return;
    
    // Open dialog
    prepBtn.addEventListener('click', () => {
        prepDialog.showModal();
    });
    
    // Close dialog
    closeDialogBtn.addEventListener('click', () => {
        prepDialog.close();
    });
    
    // Close on clicking backdrop
    prepDialog.addEventListener('click', (e) => {
        const rect = prepDialog.getBoundingClientRect();
        const isInDialog = (rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
            rect.left <= e.clientX && e.clientX <= rect.left + rect.width);
        if (!isInDialog) {
            prepDialog.close();
        }
    });
    
    // Checklist interactive toggle & localStorage save
    const checklistItems = document.querySelectorAll('#prep-checklist input[type="checkbox"]');
    checklistItems.forEach(checkbox => {
        // Load saved state
        const savedState = localStorage.getItem(`whitney-prep-${checkbox.id}`);
        if (savedState === 'true') {
            checkbox.checked = true;
            checkbox.closest('.check-item').classList.add('checked');
        }
        
        // Save state on change
        checkbox.addEventListener('change', () => {
            localStorage.setItem(`whitney-prep-${checkbox.id}`, checkbox.checked);
            if (checkbox.checked) {
                checkbox.closest('.check-item').classList.add('checked');
            } else {
                checkbox.closest('.check-item').classList.remove('checked');
            }
        });
    });
}
