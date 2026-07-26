const express = require('express');
const router = express.Router();
const { executeD1Query } = require('../sync-services-dzd');

// GET /api/services - Fetch all services from Cloudflare D1 with pagination & search
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 30, search = '', category = '' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Build WHERE clause
    let whereClause = '';
    const params = [];

    if (search) {
      whereClause += `WHERE name LIKE ? OR category LIKE ? OR service_id LIKE ?`;
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    if (category && category !== 'all') {
      if (whereClause) whereClause += ` AND category = ?`;
      else whereClause = `WHERE category = ?`;
      params.push(category);
    }

    // ── Count total ──
    const countSql = `SELECT COUNT(*) as total FROM services ${whereClause}`;
    const countResult = await executeD1Query(countSql, params);
    const total = countResult.result?.[0]?.results?.[0]?.total || 0;

    // ── Fetch paginated data ──
    const sql = `
      SELECT * FROM services
      ${whereClause}
      ORDER BY service_id ASC
      LIMIT ? OFFSET ?
    `;
    const dataResult = await executeD1Query(sql, [...params, parseInt(limit), offset]);
    const services = dataResult.result?.[0]?.results || [];

    res.json({
      success: true,
      services,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit))
    });

  } catch (error) {
    console.error('❌ Error fetching services from D1:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch services from D1' });
  }
});

module.exports = router;
