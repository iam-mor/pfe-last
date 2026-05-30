const express = require('express');
const router = express.Router();
const checkRole = require('./authMiddleware'); // 🔒 استدعاء ملف الحماية المنفصل

// 📁 التعديل هنا: استلام الـ db ومعه الـ auditLogger من ملف server.js
module.exports = (db, auditLogger) => {
    
    // 1. مسار جلب إحصائيات وطلبات الطالب الحقيقية (محمي: متاح فقط للطلاب)
    router.get('/stats/:internId', checkRole(['student']), (req, res) => {
        const internId = req.params.internId;
        
        const query = `
            SELECT r.RegistrationID AS id, r.Status AS status, r.RegistrationDate AS applied_date,
                   i.Title AS title, i.Description AS description
            FROM registration r
            JOIN internship i ON r.InternshipID = i.InternshipID
            WHERE r.InternID = ? 
            ORDER BY r.RegistrationID DESC
        `;
        
        db.query(query, [internId], (err, results) => {
            if (err) {
                console.error("🚨 MySQL Select Error:", err.message);
                // 📁 تسجيل خطأ جلب الإحصائيات في ملف السجلات
                auditLogger.error(`ERREUR API - Lecture stats pour l'étudiant ID: ${internId} - Erreur: ${err.message}`);
                return res.status(500).json({ success: false, message: "Error fetching data" });
            }
            
            if (!results || results.length === 0) {
                return res.json({ success: true, count: 0, applications: [] });
            }
            
            res.json({ success: true, count: results.length, applications: results });
        });
    });

    // 2. مسار جلب جميع عروض التربص المتاحة (محمي: متاح فقط للطلاب)
    router.get('/offers', checkRole(['student']), (req, res) => {
        const query = "SELECT * FROM internship WHERE Statut = 'open' OR Statut = 'Pending' OR Statut = 'Active' ORDER BY InternshipID DESC";
        db.query(query, (err, results) => {
            if (err) {
                console.error("Error fetching internships:", err);
                return res.status(500).json({ success: false, message: "Database error" });
            }
            
            if (!results || results.length === 0) {
                return res.json({ success: true, offers: [] });
            }
            
            res.json({ success: true, offers: results });
        });
    });

    // 3. مسار تسجيل طلب تقديم جديد (محمي: متاح فقط للطلاب)
    // ==================== مسار التقديم المتوافق تماماً مع جدول phpMyAdmin الفعلي ====================
// ==================== مسار التقديم المتوافق 100% مع أعمدة الجدول الفعلي ====================
// ==================== مسار التقديم الديناميكي الذكي لجميع الطلاب الحسابات الجديدة والقديمة ====================
router.post('/apply', (req, res) => {
    const internId = req.body.internId || req.body.InternID;
    const internshipId = req.body.internshipId || req.body.id;

    console.log("📥 معالجة طلب ديناميكي للطالب:", internId, "على العرض:", internshipId);

    if (!internId || !internshipId) {
        return res.status(400).json({ success: false, message: "Missing required data" });
    }

    // 1️⃣ الخطوة الذكية الأولى: التحقق أولاً من وجود الطالب في جدول intern، وإذا لم يكن موجوداً ننشئه تلقائياً!
    const checkInternQuery = "SELECT * FROM intern WHERE InternID = ?";
    db.query(checkInternQuery, [internId], (err, internRows) => {
        if (err) {
            console.error("❌ خطأ أثناء فحص جدول الطالب الأساسي:", err);
            return res.status(500).json({ success: false, message: "Database error during intern validation." });
        }

        // إذا كان الطالب جديد تماماً وغير مسجل في جدول intern (مثل حالة المعرف 9 أو غيره)
        if (!internRows || internRows.length === 0) {
            console.log(`⚠️ الطالب ذو المعرف ${internId} جديد؛ يتم ربطه تلقائياً بجدول intern الآن...`);
            
            // إدراج تلقائي فوري لحل مشكلة الـ Foreign Key لأي حساب جديد
            const insertInternQuery = "INSERT INTO intern (InternID) VALUES (?)";
            db.query(insertInternQuery, [internId], (insertInternErr) => {
                if (insertInternErr) {
                    console.error("❌ فشل إنشاء الطالب تلقائياً في الجدول الأساسي:", insertInternErr);
                    return res.status(500).json({ success: false, message: "Failed to sync new student profile." });
                }
                // بعد الإنشاء التلقائي بنجاح، ننتقل مباشرة لإدخال طلب التقديم
                proceedToRegistration(internId, internshipId, res, req);
            });
        } else {
            // إذا كان الطالب قديم وموجود مسبقاً، ننتقل مباشرة للتقديم
            proceedToRegistration(internId, internshipId, res, req);
        }
    });
});

// دالة فرعية مساعدة لإكمال عملية التقديم في جدول registration بدقة وبأعمدته الخمسة فقط
function proceedToRegistration(internId, internshipId, res, req) {
    // فحص التكرار لكي لا يقدم نفس الطالب على نفس العرض مرتين
    const checkRegQuery = "SELECT * FROM registration WHERE InternID = ? AND InternshipID = ?";
    db.query(checkRegQuery, [internId, internshipId], (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, message: "Database error during validation." });
        }
        if (rows && rows.length > 0) {
            return res.status(400).json({ success: false, message: "Vous avez déjà postulé à ce stage !" });
        }

        // الإدخال النهائي الصافي المتوافق مع أعمدة جدولك الخمسة
        const insertQuery = "INSERT INTO registration (InternID, InternshipID, Status, RegistrationDate) VALUES (?, ?, 'pending', NOW())";
        db.query(insertQuery, [internId, internshipId], (insertErr, result) => {
            if (insertErr) {
                console.error("❌ خطأ SQL أثناء الإدخال الفعلي:", insertErr);
                return res.status(500).json({ success: false, message: "Database error during insertion." });
            }

            console.log(`🎉 نجاح تام! تم تسجيل الطلب ديناميكياً برقم: ${result.insertId}`);
            
            // تسجيل الأثر في الـ Audit Log
            const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            if (req.auditLogger) {
                req.auditLogger.info(`CANDIDATURE SUCCESS - Intern: ${internId} -> Offer: ${internshipId} - IP: ${ip}`);
            }

            return res.json({ success: true, message: "Application submitted successfully!" });
        });
    });
}

    // 4. مسار التراجع وحذف الطلب (Undo) - (محمي: متاح فقط للطلاب)
    router.delete('/withdraw/:appId', checkRole(['student']), (req, res) => {
        const appId = req.params.appId;
        const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        const query = 'DELETE FROM registration WHERE RegistrationID = ?';
        db.query(query, [appId], (err, result) => {
            if (err) {
                console.error("🚨 MySQL Delete Error:", err.message);
                return res.status(500).json({ success: false, message: "Database error" });
            }

            // 📁 تسجيل الأثر: قيام الطالب بسحب وإلغاء طلب تربص معين
            auditLogger.info(`CANDIDATURE RETIREE - ID de demande annulée: ${appId} - IP: ${ip}`);
            
            res.json({ success: true });
        });
    });

    // 5. مسار جلب تفاصيل التربص الحالي المقبول للطالب - (محمي: متاح فقط للطلاب)
    router.get('/my-internship/:internId', checkRole(['student']), (req, res) => {
        const internId = req.params.internId;

        const query = `
            SELECT r.RegistrationID, r.Status, r.RegistrationDate,
                   i.InternshipID, i.Title, i.Description, i.InternshipProject, i.StartDate, i.EndDate
            FROM registration r
            JOIN internship i ON r.InternshipID = i.InternshipID
            WHERE r.InternID = ? AND r.Status = 'accepted'
            LIMIT 1
        `;

        db.query(query, [internId], (err, results) => {
            if (err) {
                console.error("🚨 MySQL MyInternship Error:", err.message);
                return res.status(500).json({ success: false, message: "Database error" });
            }

            if (results.length === 0) {
                return res.json({ success: true, hasInternship: false });
            }

            res.json({ success: true, hasInternship: true, internship: results[0] });
        });
    });

    // 6. مسار جلب إشعارات الطالب وتصحيح التواريخ - (محمي: متاح فقط للطلاب)
    router.get('/notifications/:internId', checkRole(['student']), (req, res) => {
        const internId = req.params.internId;

        const query = `
            SELECT 
                registration.RegistrationID, 
                registration.Status, 
                registration.RegistrationDate, 
                internship.Title AS internshipTitle
            FROM registration
            INNER JOIN internship ON registration.InternshipID = internship.InternshipID
            WHERE registration.InternID = ?
            ORDER BY registration.RegistrationID DESC
        `;

        db.query(query, [internId], (err, results) => {
            if (err) {
                console.error("🚨 MySQL Notifications Error:", err.message);
                return res.status(500).json({ success: false, message: "Database error" });
            }

            const notifications = results.map(row => {
                let message = '';
                let type = row.Status ? row.Status.toLowerCase().trim() : 'pending';

                if (type === 'accepted') {
                    message = `🎉 Congratulations! Your application for the internship "${row.internshipTitle}" has been ACCEPTED.`;
                } else if (type === 'rejected') {
                    message = `❌ Soft reminder: Your application for "${row.internshipTitle}" was not retained.`;
                } else {
                    message = `📨 Your application for "${row.internshipTitle}" is currently PENDING review by the company.`;
                }

                let formattedDate = 'N/A';
                if (row.RegistrationDate) {
                    const dateObj = new Date(row.RegistrationDate);
                    const year = dateObj.getFullYear();
                    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                    const day = String(dateObj.getDate()).padStart(2, '0');
                    formattedDate = `${year}-${month}-${day}`;
                }

                return {
                    id: row.RegistrationID,
                    message: message,
                    date: formattedDate,
                    type: type
                };
            });

            res.json({ success: true, notifications: notifications });
        });
    });

    return router;
};