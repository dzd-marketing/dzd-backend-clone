const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const cron = require('node-cron');

// ===================== CONFIGURATION =====================
const CONFIG = {
  email: {
    from: 'noreply@dzd-marketing.site',
    to: ['educatelux1@gmail.com', 'Aadilmax2023@gmail.com', 'Uvaktrading@gmail.com'],
    host: 'smtp.zoho.com',
    port: 465,
    secure: true,
    auth: {
      user: 'noreply@dzd-marketing.site',
      pass: 'aUeZ3gJN3QcF'
    }
  },
  reportFile: path.join(__dirname, 'security-reports', 'latest-report.json'),
  reportHistory: path.join(__dirname, 'security-reports', 'history.json'),
  reportInterval: '0 0 * * *', // Every day at midnight
  monitoredFiles: [
    '/etc/passwd',
    '/etc/shadow',
    '/etc/ssh/sshd_config',
    '/etc/hosts.allow',
    '/etc/hosts.deny',
    '/var/log/auth.log'
  ],
  criticalFiles: [
    '/etc/passwd',
    '/etc/shadow'
  ]
};

// Create reports directory if it doesn't exist
const reportsDir = path.join(__dirname, 'security-reports');
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

// ===================== EMAIL TRANSPORTER =====================
const transporter = nodemailer.createTransport({
  host: CONFIG.email.host,
  port: CONFIG.email.port,
  secure: CONFIG.email.secure,
  auth: CONFIG.email.auth
});

// ===================== UTILITY FUNCTIONS =====================
function execCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('en-US', { 
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).format(date);
  } catch {
    return '-';
  }
}

function getStatusEmoji(status) {
  if (status === 'good') return '✅';
  if (status === 'warning') return '⚠️';
  if (status === 'critical') return '🚨';
  return 'ℹ️';
}

// ===================== SECURITY CHECKS =====================

// 1. Check failed login attempts
async function checkFailedLogins() {
  try {
    const last24h = new Date();
    last24h.setHours(last24h.getHours() - 24);
    const timestamp = last24h.toISOString().replace('T', ' ').substring(0, 19);
    
    const results = {
      count: 0,
      details: [],
      topIPs: [],
      status: 'good'
    };

    // Get failed login attempts with IPs
    const ipCmd = `grep "Failed password" /var/log/auth.log | grep -E "^${timestamp.replace(/ /g, '\\s')}" | grep -oE "([0-9]{1,3}\\.){3}[0-9]{1,3}" | sort | uniq -c | sort -rn | head -20`;
    
    try {
      const ipOutput = await execCommand(ipCmd);
      const ipLines = ipOutput.trim().split('\n').filter(line => line.trim());
      
      let totalCount = 0;
      ipLines.forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          const count = parseInt(parts[0]);
          const ip = parts[1];
          results.details.push({ ip, count });
          totalCount += count;
        }
      });
      
      results.count = totalCount;
      results.topIPs = results.details.slice(0, 10);
      
      // Determine status
      if (results.count > 50) results.status = 'critical';
      else if (results.count > 10) results.status = 'warning';
      
      return results;
    } catch (error) {
      return { count: 0, details: [], topIPs: [], status: 'good' };
    }
  } catch (error) {
    return { count: 0, details: [], topIPs: [], status: 'good' };
  }
}

// 2. Check brute force attacks with Fail2ban integration
async function checkBruteForce() {
  try {
    const last24h = new Date();
    last24h.setHours(last24h.getHours() - 24);
    const timestamp = last24h.toISOString().replace('T', ' ').substring(0, 19);
    
    const results = {
      detected: false,
      attacks: [],
      totalAttacks: 0,
      fail2banInstalled: false,
      fail2banActive: false,
      fail2banJails: [],
      blockedIPs: [],
      totalBanned: 0,
      status: 'good'
    };

    // Check if Fail2ban is installed
    try {
      const fail2banCheck = await execCommand('which fail2ban-client');
      if (fail2banCheck.trim()) {
        results.fail2banInstalled = true;
      } else {
        results.fail2banInstalled = false;
      }
    } catch (error) {
      results.fail2banInstalled = false;
    }

    // Check if Fail2ban is active
    if (results.fail2banInstalled) {
      try {
        const fail2banStatus = await execCommand('systemctl is-active fail2ban');
        results.fail2banActive = fail2banStatus.trim() === 'active';
      } catch (error) {
        results.fail2banActive = false;
      }
    }

    // Get Fail2ban jails and blocked IPs
    if (results.fail2banActive) {
      try {
        // Get all jails
        const jailsCmd = 'fail2ban-client status | grep "Jail list" | sed "s/.*Jail list://" | tr -d " "';
        const jailsOutput = await execCommand(jailsCmd);
        const jails = jailsOutput.trim().split(',').filter(j => j);
        results.fail2banJails = jails;
        
        // Get blocked IPs from SSH jail
        if (jails.includes('sshd')) {
          try {
            const blockedCmd = `fail2ban-client status sshd | grep "Banned IP list:" | sed 's/.*Banned IP list://'`;
            const blockedOutput = await execCommand(blockedCmd);
            const blockedIPs = blockedOutput.trim().split(/\s+/).filter(ip => ip);
            results.blockedIPs = blockedIPs;
          } catch (error) {
            // SSH jail might not have banned IPs yet
          }
        }
        
        // Get all banned IPs from all jails
        let totalBanned = 0;
        for (const jail of jails) {
          try {
            const jailStatusCmd = `fail2ban-client status ${jail} | grep "Banned IP list:" | sed 's/.*Banned IP list://'`;
            const jailOutput = await execCommand(jailStatusCmd);
            const jailIPs = jailOutput.trim().split(/\s+/).filter(ip => ip);
            totalBanned += jailIPs.length;
          } catch (error) {
            // Skip if jail doesn't have banned IPs
          }
        }
        results.totalBanned = totalBanned;
      } catch (error) {
        console.error('Error getting Fail2ban status:', error);
      }
    }

    // Check for brute force patterns
    const bruteForceCmd = `grep "Failed password" /var/log/auth.log | grep -E "^${timestamp.replace(/ /g, '\\s')}" | grep -oE "([0-9]{1,3}\\.){3}[0-9]{1,3}" | sort | uniq -c | sort -rn | awk '$1 >= 5'`;
    
    try {
      const output = await execCommand(bruteForceCmd);
      const lines = output.trim().split('\n').filter(line => line.trim());
      
      lines.forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          const attempts = parseInt(parts[0]);
          const ip = parts[1];
          results.attacks.push({ ip, attempts });
        }
      });
      
      results.totalAttacks = results.attacks.reduce((sum, attack) => sum + attack.attempts, 0);
      results.detected = results.attacks.length > 0;
    } catch (error) {
      // No brute force detected
    }
    
    // Determine status
    if (results.detected && results.totalAttacks > 20) results.status = 'critical';
    else if (results.detected) results.status = 'warning';
    else if (!results.fail2banInstalled) results.status = 'warning';
    
    return results;
  } catch (error) {
    console.error('Error checking brute force:', error);
    return { 
      detected: false, 
      attacks: [], 
      totalAttacks: 0, 
      fail2banInstalled: false,
      fail2banActive: false, 
      fail2banJails: [],
      blockedIPs: [], 
      totalBanned: 0,
      status: 'good' 
    };
  }
}

// 3. Port scanning detection
async function checkPortScanning() {
  try {
    const results = {
      detected: false,
      scans: [],
      suspiciousIPs: [],
      status: 'good'
    };

    // Check auth.log for port scanning attempts
    const last24h = new Date();
    last24h.setHours(last24h.getHours() - 24);
    const timestamp = last24h.toISOString().replace('T', ' ').substring(0, 19);

    // Check for repeated connection attempts to different ports
    const scanCmd = `grep -E "Connection refused|Connection timed out|port" /var/log/auth.log | grep -E "^${timestamp.replace(/ /g, '\\s')}" | grep -oE "([0-9]{1,3}\\.){3}[0-9]{1,3}" | sort | uniq -c | sort -rn | head -10`;
    
    try {
      const output = await execCommand(scanCmd);
      const lines = output.trim().split('\n').filter(line => line.trim());
      
      lines.forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          const count = parseInt(parts[0]);
          const ip = parts[1];
          if (count > 10) { // More than 10 connection attempts might indicate scanning
            results.scans.push({ ip, attempts: count });
          }
        }
      });
      
      results.suspiciousIPs = results.scans.slice(0, 5);
      results.detected = results.scans.length > 0;
      
      if (results.detected) {
        results.status = 'warning';
        if (results.scans.length > 3) results.status = 'critical';
      }
      
      return results;
    } catch (error) {
      return { detected: false, scans: [], suspiciousIPs: [], status: 'good' };
    }
  } catch (error) {
    return { detected: false, scans: [], suspiciousIPs: [], status: 'good' };
  }
}

// 4. File integrity monitoring
async function checkFileIntegrity() {
  try {
    const results = {
      changedFiles: [],
      newFiles: [],
      criticalChanges: [],
      status: 'good'
    };

    // Load previous file checksums
    const checksumFile = path.join(reportsDir, 'file-checksums.json');
    let previousChecksums = {};
    
    if (fs.existsSync(checksumFile)) {
      try {
        const data = fs.readFileSync(checksumFile, 'utf8');
        previousChecksums = JSON.parse(data);
      } catch (error) {
        previousChecksums = {};
      }
    }

    const currentChecksums = {};
    
    // Check monitored files
    for (const file of CONFIG.monitoredFiles) {
      if (fs.existsSync(file)) {
        try {
          const stats = fs.statSync(file);
          const content = fs.readFileSync(file, 'utf8');
          const checksum = require('crypto').createHash('sha256').update(content).digest('hex');
          currentChecksums[file] = checksum;
          
          // Check if file changed
          if (previousChecksums[file] && previousChecksums[file] !== checksum) {
            results.changedFiles.push({
              file,
              oldHash: previousChecksums[file],
              newHash: checksum,
              modified: stats.mtime
            });
            
            // Check if it's a critical file
            if (CONFIG.criticalFiles.includes(file)) {
              results.criticalChanges.push(file);
            }
          }
        } catch (error) {
          // File might not exist or not accessible
        }
      }
    }

    // Save current checksums
    fs.writeFileSync(checksumFile, JSON.stringify(currentChecksums, null, 2));

    // Determine status
    if (results.criticalChanges.length > 0) results.status = 'critical';
    else if (results.changedFiles.length > 0) results.status = 'warning';

    return results;
  } catch (error) {
    return { changedFiles: [], newFiles: [], criticalChanges: [], status: 'good' };
  }
}

// 5. Check system resources
async function checkSystemResources() {
  try {
    const results = {
      cpu: 0,
      memory: 0,
      disk: 0,
      loadAverage: 0,
      uptime: 0,
      status: 'good'
    };
    
    // CPU usage
    const cpuCmd = `top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1`;
    const cpuOutput = await execCommand(cpuCmd);
    results.cpu = parseFloat(cpuOutput.trim()) || 0;
    
    // Memory usage
    const memCmd = `free -m | awk '/Mem:/ {print $3/$2 * 100.0}'`;
    const memOutput = await execCommand(memCmd);
    results.memory = parseFloat(memOutput.trim()) || 0;
    
    // Disk usage
    const diskCmd = `df -h / | awk 'NR==2 {print $5}' | sed 's/%//'`;
    const diskOutput = await execCommand(diskCmd);
    results.disk = parseInt(diskOutput.trim()) || 0;
    
    // Load average
    const loadCmd = `uptime | awk -F'load average:' '{print $2}' | awk -F',' '{print $1}'`;
    const loadOutput = await execCommand(loadCmd);
    results.loadAverage = parseFloat(loadOutput.trim()) || 0;
    
    // Uptime
    const uptimeCmd = `uptime -p`;
    const uptimeOutput = await execCommand(uptimeCmd);
    results.uptime = uptimeOutput.trim() || 'Unknown';
    
    // Determine status
    if (results.cpu > 80 || results.memory > 85 || results.disk > 90) {
      results.status = 'warning';
    }
    if (results.cpu > 95 || results.memory > 95 || results.disk > 95) {
      results.status = 'critical';
    }
    
    return results;
  } catch (error) {
    return { cpu: 0, memory: 0, disk: 0, loadAverage: 0, uptime: 0, status: 'good' };
  }
}

// 6. Check open ports
async function checkOpenPorts() {
  try {
    const cmd = `netstat -tuln | grep LISTEN | awk '{print $4}' | grep -oE "[0-9]+$" | sort -n | uniq`;
    const output = await execCommand(cmd);
    const ports = output.trim().split('\n').filter(p => p.trim());
    
    const commonPorts = [21, 22, 23, 25, 53, 80, 110, 111, 135, 139, 143, 443, 445, 993, 995, 1723, 3306, 3389, 5432, 5900, 8080, 8443];
    const suspiciousPorts = ports.filter(p => {
      const port = parseInt(p);
      return port > 1024 && !commonPorts.includes(port);
    });
    
    return {
      ports: ports,
      count: ports.length,
      suspiciousPorts: suspiciousPorts,
      status: suspiciousPorts.length > 0 ? 'warning' : 'good'
    };
  } catch (error) {
    return { ports: [], count: 0, suspiciousPorts: [], status: 'good' };
  }
}

// 7. Check running services
async function checkServices() {
  try {
    const cmd = `systemctl list-units --type=service --state=running --no-pager | grep -E "(ssh|mysql|nginx|apache|node|python|docker|redis|mongodb)" | wc -l`;
    const output = await execCommand(cmd);
    const serviceCount = parseInt(output.trim()) || 0;
    
    return {
      runningServices: serviceCount,
      suspicious: serviceCount > 25,
      status: serviceCount > 25 ? 'warning' : 'good'
    };
  } catch (error) {
    return { runningServices: 0, suspicious: false, status: 'good' };
  }
}

// ===================== GENERATE REPORT =====================
async function generateReport() {
  console.log('🛡️ Generating security report...');
  
  const report = {
    timestamp: new Date().toISOString(),
    server: {
      hostname: await execCommand('hostname').catch(() => 'Unknown'),
      ip: await execCommand('curl -s ifconfig.me').catch(() => 'Unknown'),
      os: await execCommand('cat /etc/os-release | grep PRETTY_NAME | cut -d"=" -f2 | tr -d \'"\'').catch(() => 'Unknown')
    },
    failedLogins: await checkFailedLogins(),
    bruteForce: await checkBruteForce(),
    portScanning: await checkPortScanning(),
    fileIntegrity: await checkFileIntegrity(),
    systemResources: await checkSystemResources(),
    openPorts: await checkOpenPorts(),
    services: await checkServices(),
    securityScore: 100
  };
  
  // Calculate security score
  let score = 100;
  
  if (report.failedLogins.count > 10) score -= 10;
  if (report.failedLogins.count > 50) score -= 20;
  
  if (report.bruteForce.detected) {
    score -= 20;
    if (report.bruteForce.totalAttacks > 20) score -= 10;
  }
  
  if (report.portScanning.detected) score -= 15;
  if (report.portScanning.scans.length > 3) score -= 10;
  
  if (report.fileIntegrity.criticalChanges.length > 0) score -= 30;
  if (report.fileIntegrity.changedFiles.length > 0) score -= 10;
  
  if (report.systemResources.cpu > 80) score -= 10;
  if (report.systemResources.memory > 85) score -= 10;
  if (report.systemResources.disk > 90) score -= 10;
  
  if (report.openPorts.suspiciousPorts.length > 0) score -= 15;
  if (report.services.suspicious) score -= 15;
  
  // Bonus for Fail2ban active
  if (report.bruteForce.fail2banActive) score += 10;
  
  report.securityScore = Math.max(0, Math.min(100, score));
  
  // Save report
  fs.writeFileSync(CONFIG.reportFile, JSON.stringify(report, null, 2));
  
  // Save to history
  let history = [];
  if (fs.existsSync(CONFIG.reportHistory)) {
    try {
      const data = fs.readFileSync(CONFIG.reportHistory, 'utf8');
      history = JSON.parse(data);
    } catch (error) {
      history = [];
    }
  }
  
  history.push({
    timestamp: report.timestamp,
    score: report.securityScore,
    failedLogins: report.failedLogins.count,
    bruteForce: report.bruteForce.totalAttacks,
    portScans: report.portScanning.scans.length,
    fileChanges: report.fileIntegrity.changedFiles.length
  });
  
  // Keep last 30 days
  if (history.length > 30) {
    history = history.slice(-30);
  }
  
  fs.writeFileSync(CONFIG.reportHistory, JSON.stringify(history, null, 2));
  
  return report;
}

// ===================== GENERATE EMAIL =====================
function generateEmailHTML(report) {
  const { failedLogins, bruteForce, portScanning, fileIntegrity, systemResources, openPorts, services, securityScore, server } = report;
  
  // Determine security status
  let statusColor = '#22c55e'; // Green (good)
  let statusText = 'Good';
  let statusEmoji = '🟢';
  
  if (securityScore < 60) {
    statusColor = '#ef4444';
    statusText = 'Critical';
    statusEmoji = '🔴';
  } else if (securityScore < 80) {
    statusColor = '#f59e0b';
    statusText = 'Warning';
    statusEmoji = '🟡';
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 800px; margin: 0 auto; padding: 20px; background: #f8f9fa; }
        .header { background: #1a1a1a; color: white; padding: 20px; border-radius: 10px 10px 0 0; text-align: center; }
        .header h1 { margin: 0; font-size: 24px; }
        .header p { margin: 5px 0 0; opacity: 0.8; }
        .content { background: white; padding: 20px; border-radius: 0 0 10px 10px; }
        
        .status-box { text-align: center; padding: 20px; margin: 20px 0; background: #f8f9fa; border-radius: 10px; }
        .status-emoji { font-size: 48px; display: block; }
        .status-text { font-size: 24px; font-weight: bold; color: ${statusColor}; margin: 10px 0; }
        .score-display { font-size: 36px; font-weight: bold; }
        
        .section { margin: 20px 0; padding: 15px; border: 1px solid #e5e7eb; border-radius: 8px; }
        .section-title { font-size: 16px; font-weight: bold; color: #1a1a1a; margin-bottom: 10px; }
        .section-title .emoji { margin-right: 8px; }
        
        .item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
        .item:last-child { border-bottom: none; }
        .item-label { color: #4b5563; }
        .item-value { font-weight: 500; }
        
        .badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: bold; }
        .badge-good { background: #d1fae5; color: #059669; }
        .badge-warning { background: #fef3c7; color: #d97706; }
        .badge-critical { background: #fee2e2; color: #dc2626; }
        
        .ip-list { margin: 10px 0; padding-left: 20px; }
        .ip-list li { padding: 4px 0; }
        
        .alert { padding: 12px; border-radius: 8px; margin: 10px 0; }
        .alert-danger { background: #fee2e2; border: 1px solid #fecaca; color: #991b1b; }
        .alert-warning { background: #fef3c7; border: 1px solid #fde68a; color: #92400e; }
        .alert-success { background: #d1fae5; border: 1px solid #a7f3d0; color: #065f46; }
        
        .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px; border-top: 1px solid #e5e7eb; padding-top: 20px; }
        
        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        th, td { padding: 8px; text-align: left; border-bottom: 1px solid #e5e7eb; }
        th { background: #f9fafb; font-weight: 600; color: #4b5563; }
        
        .recommandation { background: #f0fdf4; border-left: 4px solid #22c55e; padding: 12px; margin: 10px 0; }
        .recommandation-warning { background: #fef3c7; border-left: 4px solid #f59e0b; }
        .recommandation-danger { background: #fee2e2; border-left: 4px solid #ef4444; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🛡️ VPS Security Report</h1>
          <p>${formatDate(report.timestamp)}</p>
          <p style="font-size: 14px;">Server: ${server.hostname || 'Unknown'} (${server.ip || 'Unknown'})</p>
        </div>
        
        <div class="content">
          <!-- Status Box -->
          <div class="status-box">
            <span class="status-emoji">${statusEmoji}</span>
            <div class="status-text">${statusText}</div>
            <div class="score-display">
              <span style="color: ${statusColor};">${securityScore}</span>
              <span style="font-size: 18px; color: #9ca3af;">/ 100</span>
            </div>
          </div>

          <!-- Server Info -->
          <div class="section">
            <div class="section-title"><span class="emoji">🖥️</span> Server Information</div>
            <div class="item">
              <span class="item-label">Hostname</span>
              <span class="item-value">${server.hostname || 'Unknown'}</span>
            </div>
            <div class="item">
              <span class="item-label">IP Address</span>
              <span class="item-value">${server.ip || 'Unknown'}</span>
            </div>
            <div class="item">
              <span class="item-label">OS</span>
              <span class="item-value">${server.os || 'Unknown'}</span>
            </div>
            <div class="item">
              <span class="item-label">Uptime</span>
              <span class="item-value">${systemResources.uptime || 'Unknown'}</span>
            </div>
          </div>

          <!-- Failed Login Attempts -->
          <div class="section">
            <div class="section-title"><span class="emoji">🔑</span> SSH Login Attempts</div>
            <div class="item">
              <span class="item-label">Failed Attempts (24h)</span>
              <span class="item-value">
                <span class="badge ${failedLogins.status === 'critical' ? 'badge-critical' : failedLogins.status === 'warning' ? 'badge-warning' : 'badge-good'}">
                  ${failedLogins.count}
                </span>
              </span>
            </div>
            ${failedLogins.topIPs && failedLogins.topIPs.length > 0 ? `
              <div style="margin-top: 10px;">
                <strong>Top Suspicious IPs:</strong>
                <ul class="ip-list">
                  ${failedLogins.topIPs.map(ip => `
                    <li>
                      <span class="badge badge-warning">${ip.ip}</span>
                      <span style="color: #6b7280; font-size: 14px;">${ip.count} attempts</span>
                    </li>
                  `).join('')}
                </ul>
              </div>
            ` : `
              <div class="alert alert-success">✅ No failed login attempts detected</div>
            `}
          </div>

          <!-- Brute Force Protection -->
          <div class="section">
            <div class="section-title"><span class="emoji">💥</span> Brute Force Protection</div>
            <div class="item">
              <span class="item-label">Fail2ban Installed</span>
              <span class="item-value">
                ${bruteForce.fail2banInstalled ? '✅ Yes' : '❌ No'}
              </span>
            </div>
            ${bruteForce.fail2banInstalled ? `
              <div class="item">
                <span class="item-label">Fail2ban Active</span>
                <span class="item-value">
                  ${bruteForce.fail2banActive ? '✅ Yes' : '❌ No (not running)'}
                </span>
              </div>
            ` : ''}
            ${bruteForce.fail2banActive ? `
              <div class="item">
                <span class="item-label">Active Jails</span>
                <span class="item-value">${bruteForce.fail2banJails.join(', ') || 'None'}</span>
              </div>
              <div class="item">
                <span class="item-label">Total IPs Banned</span>
                <span class="item-value">
                  <span class="badge ${bruteForce.totalBanned > 0 ? 'badge-warning' : 'badge-good'}">
                    ${bruteForce.totalBanned || 0}
                  </span>
                </span>
              </div>
              ${bruteForce.blockedIPs && bruteForce.blockedIPs.length > 0 ? `
                <div style="margin-top: 10px;">
                  <strong>Currently Banned IPs (SSH):</strong>
                  <ul class="ip-list">
                    ${bruteForce.blockedIPs.map(ip => `
                      <li>
                        <span class="badge badge-critical">${ip}</span>
                        <span style="color: #6b7280; font-size: 14px;">Blocked by Fail2ban</span>
                      </li>
                    `).join('')}
                  </ul>
                </div>
              ` : `
                <div class="alert alert-success">✅ No IPs currently banned</div>
              `}
            ` : ''}
            <div class="item">
              <span class="item-label">Brute Force Attacks Detected (24h)</span>
              <span class="item-value">
                <span class="badge ${bruteForce.status === 'critical' ? 'badge-critical' : bruteForce.status === 'warning' ? 'badge-warning' : 'badge-good'}">
                  ${bruteForce.detected ? `⚠️ ${bruteForce.totalAttacks} attempts` : '✅ None'}
                </span>
              </span>
            </div>
            ${bruteForce.detected ? `
              <div style="margin-top: 10px;">
                <strong>Attack Details:</strong>
                <ul class="ip-list">
                  ${bruteForce.attacks.map(attack => `
                    <li>
                      <span class="badge badge-critical">${attack.ip}</span>
                      <span style="color: #6b7280; font-size: 14px;">${attack.attempts} attempts</span>
                    </li>
                  `).join('')}
                </ul>
                <div class="alert alert-danger">
                  🚨 Total brute force attempts: ${bruteForce.totalAttacks}
                </div>
              </div>
            ` : ''}
          </div>

          <!-- Port Scanning Detection -->
          <div class="section">
            <div class="section-title"><span class="emoji">🔍</span> Port Scanning Detection</div>
            <div class="item">
              <span class="item-label">Scanning Attempts Detected</span>
              <span class="item-value">
                <span class="badge ${portScanning.status === 'critical' ? 'badge-critical' : portScanning.status === 'warning' ? 'badge-warning' : 'badge-good'}">
                  ${portScanning.detected ? '⚠️ Yes' : '✅ No'}
                </span>
              </span>
            </div>
            ${portScanning.detected ? `
              <div style="margin-top: 10px;">
                <strong>Suspicious IPs:</strong>
                <ul class="ip-list">
                  ${portScanning.suspiciousIPs.map(ip => `
                    <li>
                      <span class="badge badge-warning">${ip.ip}</span>
                      <span style="color: #6b7280; font-size: 14px;">${ip.attempts} connection attempts</span>
                    </li>
                  `).join('')}
                </ul>
                <div class="alert alert-warning">
                  ⚠️ ${portScanning.scans.length} IPs detected with suspicious scanning patterns
                </div>
              </div>
            ` : `
              <div class="alert alert-success">✅ No port scanning detected</div>
            `}
          </div>

          <!-- File Integrity Monitoring -->
          <div class="section">
            <div class="section-title"><span class="emoji">📁</span> File Integrity Monitoring</div>
            <div class="item">
              <span class="item-label">Files Changed (24h)</span>
              <span class="item-value">
                <span class="badge ${fileIntegrity.status === 'critical' ? 'badge-critical' : fileIntegrity.status === 'warning' ? 'badge-warning' : 'badge-good'}">
                  ${fileIntegrity.changedFiles.length}
                </span>
              </span>
            </div>
            ${fileIntegrity.criticalChanges.length > 0 ? `
              <div class="alert alert-danger">
                🚨 Critical system files changed: ${fileIntegrity.criticalChanges.join(', ')}
              </div>
            ` : ''}
            ${fileIntegrity.changedFiles.length > 0 ? `
              <div style="margin-top: 10px;">
                <strong>Changed Files:</strong>
                <table>
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>Modified</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${fileIntegrity.changedFiles.map(file => `
                      <tr>
                        <td style="font-size: 12px;">${file.file}</td>
                        <td style="font-size: 12px;">${formatDate(file.modified)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            ` : `
              <div class="alert alert-success">✅ No file changes detected</div>
            `}
          </div>

          <!-- System Resources -->
          <div class="section">
            <div class="section-title"><span class="emoji">📊</span> System Resources</div>
            <div class="item">
              <span class="item-label">CPU Usage</span>
              <span class="item-value">
                <span class="badge ${systemResources.cpu > 80 ? 'badge-warning' : 'badge-good'}">
                  ${systemResources.cpu.toFixed(1)}%
                </span>
              </span>
            </div>
            <div class="item">
              <span class="item-label">Memory Usage</span>
              <span class="item-value">
                <span class="badge ${systemResources.memory > 85 ? 'badge-warning' : 'badge-good'}">
                  ${systemResources.memory.toFixed(1)}%
                </span>
              </span>
            </div>
            <div class="item">
              <span class="item-label">Disk Usage</span>
              <span class="item-value">
                <span class="badge ${systemResources.disk > 90 ? 'badge-warning' : 'badge-good'}">
                  ${systemResources.disk}%
                </span>
              </span>
            </div>
            <div class="item">
              <span class="item-label">Load Average</span>
              <span class="item-value">${systemResources.loadAverage.toFixed(2)}</span>
            </div>
            ${systemResources.cpu > 80 || systemResources.memory > 85 || systemResources.disk > 90 ? `
              <div class="alert alert-warning">
                ⚠️ High resource usage detected. Consider optimizing your server.
              </div>
            ` : `
              <div class="alert alert-success">✅ System resources are healthy</div>
            `}
          </div>

          <!-- Open Ports -->
          <div class="section">
            <div class="section-title"><span class="emoji">🔌</span> Open Ports</div>
            <div class="item">
              <span class="item-label">Total Open Ports</span>
              <span class="item-value">${openPorts.count}</span>
            </div>
            ${openPorts.suspiciousPorts.length > 0 ? `
              <div class="item">
                <span class="item-label">Suspicious Ports</span>
                <span class="item-value">
                  <span class="badge badge-warning">${openPorts.suspiciousPorts.join(', ')}</span>
                </span>
              </div>
              <div class="alert alert-warning">
                ⚠️ Suspicious ports detected. Review and close unnecessary ports.
              </div>
            ` : `
              <div class="alert alert-success">✅ No suspicious ports detected</div>
            `}
            <div style="margin-top: 10px;">
              <strong>All Open Ports:</strong>
              <span style="color: #6b7280; font-size: 14px;">${openPorts.ports.join(', ') || 'None'}</span>
            </div>
          </div>

          <!-- Running Services -->
          <div class="section">
            <div class="section-title"><span class="emoji">⚙️</span> Running Services</div>
            <div class="item">
              <span class="item-label">Running Services</span>
              <span class="item-value">
                <span class="badge ${services.suspicious ? 'badge-warning' : 'badge-good'}">
                  ${services.runningServices}
                </span>
              </span>
            </div>
            ${services.suspicious ? `
              <div class="alert alert-warning">
                ⚠️ Unusually high number of services running. Review running services.
              </div>
            ` : `
              <div class="alert alert-success">✅ Normal number of services running</div>
            `}
          </div>

          <!-- Recommendations -->
          <div class="section">
            <div class="section-title"><span class="emoji">🔧</span> Recommendations</div>
            
            ${securityScore >= 90 ? `
              <div class="recommandation">
                ✅ Great job! Your VPS is in excellent security standing.
              </div>
            ` : ''}
            
            ${!bruteForce.fail2banInstalled ? `
              <div class="recommandation recommandation-warning">
                ⚠️ <strong>Install Fail2ban:</strong> Protect your server from brute force attacks.<br>
                <code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">sudo apt install fail2ban -y</code>
              </div>
            ` : ''}
            
            ${bruteForce.fail2banInstalled && !bruteForce.fail2banActive ? `
              <div class="recommandation recommandation-warning">
                ⚠️ <strong>Start Fail2ban:</strong> It's installed but not running.<br>
                <code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">sudo systemctl start fail2ban</code><br>
                <code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">sudo systemctl enable fail2ban</code>
              </div>
            ` : ''}
            
            ${bruteForce.detected && bruteForce.fail2banActive ? `
              <div class="recommandation recommandation-success" style="background: #d1fae5; border-left: 4px solid #22c55e; padding: 12px; margin: 10px 0;">
                ✅ <strong>Fail2ban is active!</strong> It has blocked ${bruteForce.totalBanned || 0} IPs and is protecting your server.
              </div>
            ` : ''}
            
            ${openPorts.suspiciousPorts.length > 0 ? `
              <div class="recommandation recommandation-warning">
                ⚠️ <strong>Close unnecessary ports:</strong> Review and close ports: ${openPorts.suspiciousPorts.join(', ')}
              </div>
            ` : ''}
            
            ${systemResources.cpu > 80 ? `
              <div class="recommandation recommandation-warning">
                ⚠️ <strong>High CPU usage:</strong> Check running processes and optimize if needed.
              </div>
            ` : ''}
            
            ${systemResources.memory > 85 ? `
              <div class="recommandation recommandation-warning">
                ⚠️ <strong>High memory usage:</strong> Consider upgrading RAM or optimizing applications.
              </div>
            ` : ''}
            
            ${systemResources.disk > 90 ? `
              <div class="recommandation recommandation-warning">
                ⚠️ <strong>Low disk space:</strong> Clean up unnecessary files or increase disk size.
              </div>
            ` : ''}
            
            ${fileIntegrity.criticalChanges.length > 0 ? `
              <div class="recommandation recommandation-danger">
                🚨 <strong>Critical file changes detected:</strong> Investigate changes to: ${fileIntegrity.criticalChanges.join(', ')}
              </div>
            ` : ''}
            
            <div style="margin-top: 15px; padding: 10px; background: #f8f9fa; border-radius: 6px;">
              <strong>💡 Quick Security Tips:</strong>
              <ul style="margin: 10px 0 0 20px; color: #4b5563;">
                <li>Enable SSH key authentication instead of passwords</li>
                <li>Change SSH port from default (22) to a custom port</li>
                <li>Keep your system updated: <code>sudo apt update && sudo apt upgrade</code></li>
                <li>Use a firewall: <code>sudo ufw enable</code></li>
              </ul>
            </div>
          </div>
        </div>
        
        <div class="footer">
          <p>Automated security report generated every 24 hours</p>
          <p>DZD Marketing Security Monitor</p>
          <p style="font-size: 12px; color: #9ca3af;">Report ID: ${Date.now()}</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

// ===================== SEND EMAIL =====================
async function sendEmailReport(report) {
  console.log('📧 Sending email report...');
  
  const htmlContent = generateEmailHTML(report);
  
  const mailOptions = {
    from: CONFIG.email.from,
    to: CONFIG.email.to.join(', '),
    subject: `🛡️ VPS Security Report - ${new Date().toLocaleDateString()}`,
    html: htmlContent
  };
  
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent successfully!');
    console.log('Message ID:', info.messageId);
    return true;
  } catch (error) {
    console.error('❌ Failed to send email:', error);
    return false;
  }
}

// ===================== MAIN FUNCTION =====================
async function runSecurityCheck() {
  try {
    console.log('🔒 Starting VPS security check...');
    console.log('Time:', new Date().toLocaleString());
    
    // Generate report
    const report = await generateReport();
    
    // Send email
    await sendEmailReport(report);
    
    console.log('✅ Security check completed successfully!');
    console.log('📊 Security Score:', report.securityScore);
    
    return report;
  } catch (error) {
    console.error('❌ Security check failed:', error);
    return null;
  }
}

// ===================== SCHEDULE REPORTS =====================
function scheduleReports() {
  console.log('📅 Scheduling security reports...');
  console.log('⏰ Reports will be sent every 24 hours at midnight');
  console.log('📧 Sending to:', CONFIG.email.to.join(', '));
  
  // Run immediately on first execution
  setTimeout(() => {
    runSecurityCheck();
  }, 5000);
  
  // Schedule for every 24 hours
  cron.schedule(CONFIG.reportInterval, () => {
    console.log('⏰ Running scheduled security report...');
    runSecurityCheck();
  });
  
  console.log('✅ VPS Security Monitor started successfully!');
}

// ===================== START =====================
// Check if running as a service
if (require.main === module) {
  scheduleReports();
}

// Export for use in other scripts
module.exports = {
  runSecurityCheck,
  generateReport,
  CONFIG
};
