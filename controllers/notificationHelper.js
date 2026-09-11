function maskUserName(name) {
  if (!name || name.length < 5) return name || 'Someone';
  
  const first = name.slice(0, 3);
  const last = name.slice(-2);
  const stars = '*'.repeat(Math.min(name.length - 5, 4));
  
  return `${first}${stars}${last}`;
}

/**
 * Send live notification to all connected users
 */
function sendLiveNotification(io, data) {
  if (!io) {
    console.log('⚠️ Socket.io not initialized');
    return;
  }
  
  const notification = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: data.type || 'info',
    title: data.title || 'New Activity',
    message: data.message || '',
    userName: data.userName || 'Someone',
    amount: data.amount || null,
    currency: data.currency || 'LKR',
    icon: data.icon || '⚡',
    color: data.color || '#3b82f6',
    timestamp: new Date().toISOString()
  };
  
  // Broadcast to ALL connected clients
  io.emit('live_notification', notification);
  
  console.log(`📢 [Notification] ${notification.title}`);
}

module.exports = { sendLiveNotification, maskUserName };
