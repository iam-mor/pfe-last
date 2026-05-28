const express = require('express');
const router = express.Router();
const checkRole = require('./authMiddleware'); // 🔒 استدعاء ملف الحماية المنفصل للقسم

// 📁 التعديل هنا: استلام الـ db ومعه الـ auditLogger من ملف server.js
module.exports = function(db, auditLogger) {

    // ==================== 1. إحصائيات لوحة التحكم الديناميكية (محمي: متاح فقط للقسم) ====================
    router.get('/stats', checkRole(['department']), (req, res) => {
        const statsQuery = `
            SELECT 
                (SELECT COUNT(*) FROM company) AS totalCompanies,
                (SELECT COUNT(*) FROM registration WHERE Status = 'pending_verification' OR Status = 'pending') AS pendingCompanies,
                (SELECT COUNT(*) FROM registration WHERE Status = 'accepted' OR Status = 'verified') AS pendingAgreements,
                (SELECT COUNT(*) FROM internship) AS totalOffers, 
                (SELECT COUNT(*) FROM registration WHERE Status = 'evaluation_submitted' OR Status = 'completed') AS signatureCount
        `;
        
        db.query(statsQuery, (err, results) => {
            if (err) {
                console.error("خطأ في حساب الإحصائيات:", err);
                // 📁 تسجيل خطأ قراءة الإحصائيات الإدارية
                auditLogger.error(`ERREUR API - Lecture des statistiques globales de l'administration - Erreur: ${err.message}`);
                return res.json({ 
                    success: true, 
                    stats: { totalCompanies: 0, pendingCompanies: 0, pendingAgreements: 0, totalOffers: 0, signatureCount: 0 },
                    availableOffers: 0, 
                    appliedCount: 0
                });
            }
            
            const row = results[0] || { totalCompanies: 0, pendingCompanies: 0, pendingAgreements: 0, totalOffers: 0, signatureCount: 0 };
            
            // إرسال الرد بالتسميات الخاصة بالقسم وبصفحة الطالب معاً ليجبر الخانات على التحول إلى 0
            res.json({ 
                success: true, 
                stats: row,
                availableOffers: row.totalOffers || 0, 
                appliedCount: row.pendingCompanies || 0
            });
        });
    });

    // ==================== 2. جلب قائمة الشركات - (محمي: متاح فقط للقسم) ====================
    router.get('/companies', checkRole(['department']), (req, res) => {
        const query = "SELECT c.*, r.RegistrationDate, r.Status FROM company c LEFT JOIN registration r ON c.CompanyID = r.RegistrationID";
        db.query(query, (err, results) => {
            if (err || !results || results.length === 0) {
                return res.json({ success: true, companies: [] });
            }
            
            const formatted = results.map(c => ({
                id: String(c.CompanyID),
                companyName: c.Name,
                email: c.Email,
                phone: c.Phone || 'N/A',
                address: c.Address || 'N/A',
                sector: c.Sector || 'N/A',
                status: c.Status || 'pending_verification',
                registeredDate: c.RegistrationDate ? new Date(c.RegistrationDate).toISOString().split('T')[0] : 'N/A'
            }));
            res.json({ success: true, companies: formatted });
        });
    });

    // ==================== 3. تحديث حالة الشركة - (محمي: متاح فقط للقسم) ====================
    router.put('/company/:id/status', checkRole(['department']), (req, res) => {
        const companyId = req.params.id;
        const { status } = req.body;
        const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        
        const query = "UPDATE registration SET Status = ? WHERE RegistrationID = ?";
        db.query(query, [status, companyId], (err, result) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ success: false, message: "Database error" });
            }

            // 📁 تسجيل الأثر الإداري: توثيق من قام بتغيير حالة الشركة (مثلا: تفعيل حساب منشأة)
            auditLogger.info(`STATUT ENTREPRISE MODIFIE - Par l'administration - Entreprise ID: ${companyId} - Nouveau Statut: ${status} - IP: ${ip}`);
            
            res.json({ success: true, message: `Status updated to ${status}` });
        });
    });

    // ==================== 4. جلب طلبات التربص - (محمي: متاح فقط للقسم) ====================
    router.get('/applications', checkRole(['department']), (req, res) => {
        const query = `
            SELECT i.*, r.RegistrationDate, r.Status as RegStatus
            FROM internship i
            LEFT JOIN registration r ON i.InternshipID = r.InternshipID
            ORDER BY i.id DESC
        `;
        
        db.query(query, (err, results) => {
            if (err || !results || results.length === 0) {
                return res.json({ success: true, applications: [] }); 
            }
            
            const formattedResults = results.map(app => ({
                id: app.id || app.InternshipID,
                studentName: app.studentName || 'Student',
                company: app.company || 'Company',
                internshipTitle: app.internshipTitle || 'Internship',
                date: app.RegistrationDate ? new Date(app.RegistrationDate).toISOString().split('T')[0] : 'N/A',
                status: app.RegStatus || 'pending',
                evaluation: {},
                diplomaSignedByCompany: false
            }));
            
            res.json({ success: true, applications: formattedResults });
        });
    });

    // ==================== 5. تحديث وتوقيع التربصات - (محمي: متاح فقط للقسم) ====================
    router.put('/application/:id/finalize', checkRole(['department']), (req, res) => {
        const appId = req.params.id;
        const { status } = req.body;
        const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        
        const query = "UPDATE registration SET Status = ? WHERE InternshipID = ?";
        db.query(query, [status, appId], (err, result) => {
            if (err) return res.status(500).json({ success: false });

            // 📁 تسجيل الأثر الإداري الحرج: توثيق من قام بإعطاء الموافقة النهائية أو التوقيع على التربص
            auditLogger.info(`STAGE FINALISE/SIGNE - Par l'administration - Stage ID: ${appId} - Action/Statut: ${status} - IP: ${ip}`);
            
            res.json({ success: true, message: "Internship updated successfully" });
        });
    });

    // ==================== 6. جلب قائمة الطلاب - (محمي: متاح فقط للقسم) ====================
    router.get('/students', checkRole(['department']), (req, res) => {
        const query = `
            SELECT i.*, r.RegistrationDate, r.Status as StudentStatus
            FROM intern i
            LEFT JOIN registration r ON i.InternID = r.InternID
        `;
        db.query(query, (err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ success: false, message: "Database error" });
            }
            
            const formattedStudents = results.map(s => {
                let formattedRegDate = 'N/A';
                if (s.RegistrationDate) {
                    try {
                        const d = new Date(s.RegistrationDate);
                        if (!isNaN(d.getTime())) {
                            formattedRegDate = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
                        }
                    } catch (e) {
                        formattedRegDate = 'N/A';
                    }
                }

                return {
                    id: s.InternID,
                    firstName: s.FirstName,
                    lastName: s.LastName,
                    email: s.Email,
                    degree: s.Degree || 'N/A',
                    specialization: s.Specialization || s.speciality || 'Computer Science', 
                    registeredDate: formattedRegDate,
                    status: s.StudentStatus || 'Active'
                };
            });
            res.json({ success: true, students: formattedStudents });
        });
    });

    return router;
};