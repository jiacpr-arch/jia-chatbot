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

// GET handler — handles both testing and Calendar booking actions
function doGet(e) {
  var params = e.parameter;

  // ---- Google Calendar Booking ----
  // Called by api/lib/calendar.js with action=createBooking
  if (params.action === 'createBooking') {
    try {
      var calendarId = 'primary'; // หรือใส่ Calendar ID เฉพาะของ JIA
      var cal = CalendarApp.getCalendarById(calendarId) || CalendarApp.getDefaultCalendar();

      var name = params.name || 'ลูกค้า';
      var phone = params.phone || '';
      var courseType = params.courseType || 'CPR Savelife';
      var dateStr = params.date || '';  // YYYY-MM-DD
      var timeStr = params.time || '09:00'; // HH:MM
      var note = params.note || '';
      var platform = params.platform || 'bot';

      if (!dateStr) {
        return ContentService.createTextOutput(JSON.stringify({
          success: false, message: 'ไม่ระบุวันที่'
        })).setMimeType(ContentService.MimeType.JSON);
      }

      // Build start/end datetime
      var parts = dateStr.split('-');
      var timeParts = timeStr.split(':');
      var startDate = new Date(
        parseInt(parts[0]),
        parseInt(parts[1]) - 1,
        parseInt(parts[2]),
        parseInt(timeParts[0]),
        parseInt(timeParts[1] || 0)
      );
      var endDate = new Date(startDate.getTime() + 3.5 * 60 * 60 * 1000); // +3.5 ชม.

      var title = '[' + courseType + '] ' + name;
      var description =
        'ชื่อ: ' + name + '\n' +
        'เบอร์โทร: ' + phone + '\n' +
        'คอร์ส: ' + courseType + '\n' +
        'แหล่งที่มา: ' + platform + '\n' +
        (note ? 'หมายเหตุ: ' + note : '');

      var event = cal.createEvent(title, startDate, endDate, {
        description: description,
        location: 'The Street Ratchada ชั้น 3, MRT ศูนย์วัฒนธรรม',
      });

      // Also log to Bookings sheet
      try {
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var bookSheet = ss.getSheetByName('Bookings') || ss.insertSheet('Bookings');
        if (bookSheet.getLastRow() === 0) {
          bookSheet.appendRow(['วันที่จอง', 'วันเรียน', 'เวลา', 'ชื่อ', 'เบอร์', 'คอร์ส', 'ช่องทาง', 'Event ID']);
          bookSheet.getRange(1, 1, 1, 8).setFontWeight('bold');
        }
        bookSheet.appendRow([
          new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
          dateStr, timeStr, name, phone, courseType, platform, event.getId()
        ]);
      } catch(sheetErr) {
        Logger.log('Booking sheet error: ' + sheetErr);
      }

      // Send notification email
      try {
        MailApp.sendEmail({
          to: 'jiacpr@gmail.com',
          subject: '📅 จองคอร์สใหม่ — ' + name + ' (' + courseType + ')',
          body: 'มีการจองคอร์สใหม่จากบอทค่ะ!\n\n' +
                'ชื่อ: ' + name + '\n' +
                'เบอร์โทร: ' + phone + '\n' +
                'คอร์ส: ' + courseType + '\n' +
                'วัน-เวลา: ' + dateStr + ' ' + timeStr + '\n' +
                'ช่องทาง: ' + platform + '\n\n' +
                'ดู Calendar: https://calendar.google.com'
        });
      } catch(emailErr) {
        Logger.log('Email error: ' + emailErr);
      }

      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        eventId: event.getId(),
        eventLink: 'https://calendar.google.com',
        message: 'จองสำเร็จค่ะ!'
      })).setMimeType(ContentService.MimeType.JSON);

    } catch(calErr) {
      Logger.log('Calendar error: ' + calErr);
      return ContentService.createTextOutput(JSON.stringify({
        success: false, message: 'ระบบจองขัดข้อง: ' + calErr.message
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  // Default: health check
  return ContentService.createTextOutput(JSON.stringify({
    status: 'active',
    service: 'JIA Chatbot Webhook',
    endpoints: ['POST /?action=logLead', 'GET /?action=createBooking']
  })).setMimeType(ContentService.MimeType.JSON);
}
