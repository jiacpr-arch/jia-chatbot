/**
 * Google Apps Script สำหรับ JIA Chatbot Lead Tracking
 *
 * วิธีติดตั้ง:
 * 1. สร้าง Google Sheet ใหม่
 * 2. ตั้งชื่อ header แถวที่ 1:
 *    A: วันที่ | B: ชื่อ | C: PSID | D: ช่องทาง | E: ประเภท | F: ระดับ | G: ช่วงเวลา | H: จำนวนคน | I: ข้อความ | J: แหล่งที่มา | K: สถานะ | L: อีเมล | M: เบอร์โทร | N: ผู้รับผิดชอบ | O: หมายเหตุ
 * 3. Extensions → Apps Script
 * 4. ลบโค้ดเดิม → วางโค้ดนี้ทั้งหมด
 * 5. กด Deploy → New deployment → Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 6. Copy URL → ใส่ใน Vercel env: GOOGLE_SHEET_WEBHOOK_URL
 */

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Leads') || SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = JSON.parse(e.postData.contents);

    // สร้าง header ถ้ายังไม่มี
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        'วันที่', 'ชื่อ', 'PSID', 'ช่องทาง', 'ประเภท', 'ระดับ',
        'ช่วงเวลา', 'จำนวนคน', 'ข้อความ', 'แหล่งที่มา', 'สถานะ',
        'อีเมล', 'เบอร์โทร', 'ผู้รับผิดชอบ', 'หมายเหตุ'
      ]);
      // Bold header
      sheet.getRange(1, 1, 1, 15).setFontWeight('bold');
    }

    // Map level to Thai
    var levelMap = { 'hot': '🔥 พร้อมจอง', 'warm': '🟡 สนใจ', 'cold': '🔵 ยังไม่แน่ใจ' };
    var typeMap = { 'individual': 'บุคคลทั่วไป', 'corporate': 'องค์กร', 'aed': 'AED', 'lead_ad': 'Lead Ads' };

    sheet.appendRow([
      data.timestamp || new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
      data.name || '',
      data.psid || '',
      data.platform || 'Messenger',
      typeMap[data.type] || data.type || '',
      levelMap[data.level] || data.level || '',
      data.timing || '',
      data.corpSize || '',
      data.message || '',
      data.source || '',
      'ใหม่',
      data.email || '',
      data.phone || '',
      '',  // ผู้รับผิดชอบ (ทีมกรอกเอง)
      ''   // หมายเหตุ
    ]);

    // Color code by level
    var lastRow = sheet.getLastRow();
    var levelCell = sheet.getRange(lastRow, 6);
    if (data.level === 'hot') {
      sheet.getRange(lastRow, 1, 1, 15).setBackground('#fce4ec');  // light red
    } else if (data.level === 'warm') {
      sheet.getRange(lastRow, 1, 1, 15).setBackground('#fff8e1');  // light yellow
    }

    // Send notification email for hot leads
    if (data.level === 'hot') {
      try {
        MailApp.sendEmail({
          to: 'jiacpr@gmail.com',
          subject: '🔥 HOT Lead ใหม่ — ' + (data.name || 'ไม่ทราบชื่อ'),
          body: 'Lead ใหม่จาก ' + (data.platform || 'Messenger') + '\n\n' +
                'ชื่อ: ' + (data.name || '-') + '\n' +
                'ประเภท: ' + (typeMap[data.type] || data.type || '-') + '\n' +
                'ช่วงเวลา: ' + (data.timing || '-') + '\n' +
                'ข้อความ: ' + (data.message || '-') + '\n' +
                'อีเมล: ' + (data.email || '-') + '\n' +
                'เบอร์โทร: ' + (data.phone || '-') + '\n\n' +
                'เปิด Sheet: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl()
        });
      } catch(emailErr) {
        Logger.log('Email error: ' + emailErr);
      }
    }

    return ContentService.createTextOutput('OK');
  } catch(err) {
    Logger.log('Error: ' + err);
    return ContentService.createTextOutput('Error: ' + err);
  }
}

// GET handler for testing
function doGet(e) {
  return ContentService.createTextOutput('JIA Lead Sheet Webhook is active');
}
