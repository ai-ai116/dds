const API_BASE = '/api';

// ==================== Load Stats & History on Page Load ====================
document.addEventListener('DOMContentLoaded', () => {
    loadStats();
    loadHistory();
    setupModeToggle();
});

function setupModeToggle() {
    const modeSelect = document.getElementById('numberMode');
    const phoneGroup = document.getElementById('phoneGroup');
    
    modeSelect.addEventListener('change', () => {
        if (modeSelect.value === 'random') {
            phoneGroup.style.display = 'none';
        } else {
            phoneGroup.style.display = 'block';
        }
    });
}

// ==================== Load Stats ====================
async function loadStats() {
    try {
        const res = await fetch(`${API_BASE}/stats`);
        const data = await res.json();
        
        if (data.success) {
            document.getElementById('totalRequests').textContent = data.stats.totalRequests.toLocaleString();
            document.getElementById('successfulPairs').textContent = data.stats.successfulPairs.toLocaleString();
            document.getElementById('failedPairs').textContent = data.stats.failedPairs.toLocaleString();
        }
    } catch (err) {
        console.error('Failed to load stats:', err);
    }
}

// ==================== Load History ====================
async function loadHistory() {
    try {
        const res = await fetch(`${API_BASE}/history?limit=50`);
        const data = await res.json();
        
        const tbody = document.getElementById('historyBody');
        const countEl = document.getElementById('historyCount');
        
        if (data.success && data.history.length > 0) {
            countEl.textContent = data.total;
            
            tbody.innerHTML = data.history.map((h, i) => `
                <tr>
                    <td>${i + 1}</td>
                    <td>${h.phoneNumber}</td>
                    <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;">${h.serverUrl || 'N/A'}</td>
                    <td class="status-${h.status}">${h.pairCode || '---'}</td>
                    <td class="status-${h.status}">${h.status.toUpperCase()}</td>
                    <td>${new Date(h.createdAt).toLocaleString()}</td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#888;">No history yet</td></tr>';
            countEl.textContent = '0';
        }
    } catch (err) {
        console.error('Failed to load history:', err);
    }
}

// ==================== Generate Pairs ====================
let isRunning = false;
let shouldStop = false;

async function generatePairs() {
    if (isRunning) return;
    
    const serverUrl = document.getElementById('serverUrl').value.trim();
    const phoneNumber = document.getElementById('phoneNumber').value.trim();
    const requestCount = parseInt(document.getElementById('requestCount').value) || 1;
    const numberMode = document.getElementById('numberMode').value;
    
    // Validation
    if (numberMode === 'custom' && !phoneNumber) {
        alert('Please enter a phone number in custom mode');
        return;
    }
    
    if (requestCount < 1 || requestCount > 1000000) {
        alert('Request count must be between 1 and 1,000,000');
        return;
    }
    
    // Confirmation for large batches
    if (requestCount > 100) {
        const confirmMsg = `You are about to send ${requestCount.toLocaleString()} pair requests.\n\nThis may take a long time. Continue?`;
        if (!confirm(confirmMsg)) return;
    }
    
    isRunning = true;
    shouldStop = false;
    
    // UI updates
    document.getElementById('generateBtn').textContent = '⏳ Processing...';
    document.getElementById('generateBtn').disabled = true;
    document.getElementById('stopBtn').style.display = 'inline-block';
    document.getElementById('resultsCard').style.display = 'block';
    document.getElementById('resultsContent').innerHTML = '';
    document.getElementById('progressContainer').style.display = 'block';
    
    let successful = 0;
    let failed = 0;
    const results = [];
    
    try {
        const res = await fetch(`${API_BASE}/pair-batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phoneNumber: numberMode === 'random' ? '' : phoneNumber,
                serverUrl,
                count: requestCount,
                mode: numberMode
            })
        });
        
        const data = await res.json();
        
        if (data.success) {
            data.results.forEach((r, i) => {
                if (r.success) {
                    successful++;
                    results.push(`<span class="success">✅ #${i+1}: ${r.phone} → Code: ${r.code}</span>`);
                } else {
                    failed++;
                    results.push(`<span class="error">❌ #${i+1}: ${r.phone} → Error: ${r.error}</span>`);
                }
            });
            
            document.getElementById('resultsContent').innerHTML = results.join('<br>');
            document.getElementById('progressFill').style.width = '100%';
            document.getElementById('progressText').textContent = 
                `✅ Complete! ${successful} successful, ${failed} failed out of ${data.totalRequested} requests`;
        } else {
            document.getElementById('resultsContent').innerHTML = 
                `<span class="error">❌ Error: ${data.message}</span>`;
        }
        
    } catch (err) {
        document.getElementById('resultsContent').innerHTML = 
            `<span class="error">❌ Connection error: ${err.message}</span>`;
    }
    
    // Reset UI
    document.getElementById('generateBtn').textContent = '⚡ Generate & Send';
    document.getElementById('generateBtn').disabled = false;
    document.getElementById('stopBtn').style.display = 'none';
    
    isRunning = false;
    
    // Refresh stats & history
    loadStats();
    loadHistory();
}

function stopGeneration() {
    shouldStop = true;
    document.getElementById('stopBtn').textContent = '⏹ Stopping...';
    document.getElementById('stopBtn').disabled = true;
}

// ==================== Clear History ====================
async function clearHistory() {
    if (!confirm('Clear all history?')) return;
    
    try {
        const res = await fetch(`${API_BASE}/history`, { method: 'DELETE' });
        const data = await res.json();
        
        if (data.success) {
            alert('History cleared');
            loadHistory();
            loadStats();
        }
    } catch (err) {
        alert('Error clearing history');
    }
}
