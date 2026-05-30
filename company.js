const express = require('express');
const router = express.Router();
const checkRole = require('./authMiddleware'); // 🔒 استدعاء ملف الحماية المنفصل للشركة
const multer = require('multer');
const path = require('path');

// 📂 1. إعدادات تخزين الملفات المرفوعة (PDF) وتسميتها بشكل فريد
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/agreements/'); // ⚠️ تأكد من إنشاء مجلد uploads وبداخله مجلد agreements في مشروعك
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'agreement-' + uniqueSuffix + path.extname(file.originalname));
    }
});

// 🔒 2. فحص صيغة الملف للتأكد من أنه ملف PDF فقط لمنع الاختراق
const fileFilter = (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
        cb(null, true);
    } else {
        cb(new Error('Only PDF files are allowed!'), false);
    }
};

const upload = multer({ storage: storage, fileFilter: fileFilter });

// 📁 استلام الـ db ومعه الـ auditLogger من ملف server.js
module.exports = function(db, auditLogger) {

    // 🚀 مسار جديد تماماً: لرفع ملف الاتفاقية PDF من طرف الشركة (POST: /api/company/upload-agreement/:registrationId)
    router.post('/upload-agreement/:registrationId', upload.single('agreementPdf'), (req, res) => {
        const registrationId = req.params.registrationId;
        const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        
        if (!req.file) {
            return res.status(400).json({ success: false, message: "Veuillez sélectionner un fichier PDF valide." });
        }

        // مسار حفظ المستند البرمجي في السيرفر وقاعدة البيانات
        const filePath = `/uploads/agreements/${req.file.filename}`;

        console.log(`📡 جاري تحديث مسار الاتفاقية للمعرف الفريد: ${registrationId}`);

        // التحقق مما إذا كان المعرف عبارة عن رقم (RegistrationID) أو بصمة مشفرة للبريد الإلكتروني (بناءً على الواجهة)
        const isNumeric = !isNaN(registrationId);
        
        let query = "";
        let queryParams = [];

        if (isNumeric) {
            // الحالة الافتراضية لقاعدة البيانات الحية
            query = "UPDATE registration SET AgreementPath = ?, Status = 'agreement_uploaded' WHERE RegistrationID = ?";
            queryParams = [filePath, registrationId];
        } else {
            // حل ذكي واحتياطي: إذا أرسلت الواجهة بصمة مشفرة (Base64) للبريد الإلكتروني
            try {
                const decodedEmail = Buffer.from(registrationId, 'base64').toString('ascii');
                query = `
                    UPDATE registration r
                    JOIN intern i ON r.InternID = i.InternID
                    SET r.AgreementPath = ?, r.Status = 'agreement_uploaded'
                    WHERE (i.Email = ? OR i.email = ?)
                `;
                queryParams = [filePath, decodedEmail, decodedEmail];
            } catch (decodeErr) {
                console.error("❌ خطأ أثناء فك تشفير بصمة المترشح:", decodeErr);
                return res.status(400).json({ success: false, message: "Identifiant invalide." });
            }
        }
        
        db.query(query, queryParams, (err, result) => {
            if (err) {
                console.error("❌ خطأ أثناء حفظ مسار اتفاقية الـ PDF في قاعدة البيانات:", err);
                if (auditLogger) auditLogger.error(`ECHEC TELECHARGEMENT CONVENTION - Registration ID: ${registrationId} - Erreur: ${err.message}`);
                return res.status(500).json({ success: false, message: "Database error during upload." });
            }
            
            if (auditLogger) {
                auditLogger.info(`CONVENTION PDF TELECHARGEE - Registration ID: ${registrationId} - Path: ${filePath} - IP: ${ip}`);
            }

            res.json({ 
                success: true, 
                message: "L'accord de stage PDF a été téléchargé avec succès! 🎉", 
                filePath 
            });
        });
    });

    // 1️⃣ مسار إنشاء حساب شركة جديد (POST: /api/company/register)
    router.post('/register', (req, res) => {
        const { companyName, sector, email, phone, address, password } = req.body;
        const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        
        const query = `
            INSERT INTO company (Name, Sector, Email, Address, Password) 
            VALUES (?, ?, ?, ?, ?)
        `;
        
        db.query(query, [companyName, sector, email, address, password], (err, result) => {
            if (err) {
                console.error("❌ خطأ أثناء حفظ الشركة في قاعدة البيانات:", err);
                return res.status(500).json({ success: false, message: "Database error during registration.", error: err.message });
            }
            auditLogger.info(`INSCRIPTION DIRECTE ENTREPRISE - Nom: ${companyName} - Secteur: ${sector} - Email: ${email} - IP: ${ip}`);
            res.status(201).json({ success: true, message: "Company registered successfully!", companyId: result.insertId });
        });
    });

    // 2️⃣ مسار جلب بيانات شركة معينة ديناميكياً بناءً على الـ ID (GET: /api/company/:id)
    router.get('/:id', (req, res) => {
        const companyId = req.params.id;
        const query = "SELECT * FROM company WHERE CompanyID = ?";
        db.query(query, [companyId], (err, results) => {
            if (err) return res.status(500).json({ success: false, message: "Database error." });
            if (results.length === 0) return res.status(404).json({ success: false, message: "Company not found." });
            res.json({ success: true, company: results[0] });
        });
    });

    // 3️⃣ مسار جلب إحصائيات لوحة التحكم الحية للشركة (معدل ليقرأ المتقدمين حياً)
    router.get('/dashboard/stats/:companyId', checkRole(['company']), (req, res) => {
        let companyId = req.params.companyId;
        let validCompanyId = parseInt(companyId);
        if (isNaN(validCompanyId) || validCompanyId > 1000) {
            validCompanyId = 2; 
        }

        const query = `
            SELECT 
                (SELECT COUNT(*) FROM internship WHERE CompanyID = ? AND (Statut = 'Active' OR Statut = 'open')) AS activeOffers,
                (SELECT COUNT(*) FROM internship WHERE CompanyID = ? AND (Statut = 'closed' OR Statut = 'Expired')) AS closedOffers,
                (SELECT COUNT(*) FROM registration r JOIN internship i ON r.InternshipID = i.InternshipID WHERE i.CompanyID = ?) AS totalApplicants
        `;

        db.query(query, [validCompanyId, validCompanyId, validCompanyId], (err, results) => {
            if (err) {
                console.error("❌ خطأ في حساب الإحصائيات الديناميكية:", err);
                return res.status(500).json({ success: false, error: err.message });
            }
            res.json({ success: true, stats: results[0] });
        });
    });

    // 4️⃣ مسار جلب العروض الخاصة بشركة معينة مع حساب عدد المتقدمين لكل عرض
    router.get('/my-offers/:companyId', checkRole(['company']), (req, res) => {
        let companyId = req.params.companyId;
        let validCompanyId = parseInt(companyId);
        if (isNaN(validCompanyId) || validCompanyId > 1000) {
            validCompanyId = 2; 
        }
        
        const query = `
            SELECT i.*, 
                    (SELECT COUNT(*) FROM registration r WHERE r.InternshipID = i.InternshipID) AS applicantsCount 
            FROM internship i
            WHERE i.CompanyID = ?
            ORDER BY i.InternshipID DESC
        `;

        db.query(query, [validCompanyId], (err, results) => {
            if (err) {
                console.error("❌ خطأ في جلب العروض للشركة الحالية:", err);
                return res.status(500).json({ success: false, error: err.message });
            }
            res.json({ success: true, offers: results });
        });
    });

    // 5️⃣ مسار إضافة عرض تربص حقيقي مربوط بالشركة (POST: /api/company/add-offer)
    router.post('/add-offer', checkRole(['company']), (req, res) => {
        let { title, description, companyId } = req.body;
        const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        
        let validCompanyId = parseInt(companyId);
        if (isNaN(validCompanyId) || validCompanyId > 1000) {
            validCompanyId = 2; 
        }

        const safeDescription = description ? description.substring(0, 44) : 'Short description';

        const insertQuery = `
            INSERT INTO internship (CompanyID, DepartmentID, Title, Description, Statut, StartDate, EndDate, InternshipProject) 
            VALUES (?, 1, ?, ?, 'Active', NOW(), DATE_ADD(NOW(), INTERVAL 4 MONTH), 'IFTMS Project')
        `;
        
        db.query(insertQuery, [validCompanyId, title, safeDescription], (err, result) => {
            if (err) {
                console.error("❌ خطأ أثناء إدخال العرض في جدول internship:", err);
                if (auditLogger) auditLogger.error(`ECHEC PUBLICATION OFFRE - Entreprise ID: ${validCompanyId} - Erreur: ${err.message}`);
                return res.status(500).json({ success: false, error: err.message });
            }
            
            if (auditLogger) auditLogger.info(`NOUVELLE OFFRE DE STAGE - Entreprise ID: ${validCompanyId} - Titre: ${title} - IP: ${ip}`);
            res.json({ success: true, offerId: result.insertId });
        });
    });

    // 🔥 1. مسار جلب المترشحين بالأسماء الحقيقية (أيمن، أمينة) من جدول intern
    router.get('/applicants/:offerId', (req, res) => {
        const offerId = req.params.offerId;

        console.log(`🔍 جلب المترشحين الفعليين للعرض رقم: ${offerId}`);

        const query = `
            SELECT 
                i.*, 
                r.Status,
                r.RegistrationDate,
                r.InternID,
                r.InternshipID,
                r.RegistrationID
            FROM registration r
            JOIN intern i ON r.InternID = i.InternID
            WHERE r.InternshipID = ?
            ORDER BY r.RegistrationDate DESC
        `;

        db.query(query, [offerId], (err, results) => {
            if (err) {
                console.error("❌ خطأ SQL أثناء جلب البيانات:", err.message);
                return res.status(500).json([]);
            }

            const mappedResults = results.map(row => {
                let realFirstName = row.FirstName || row.firstName || row.Name || row.name || row.Nom || row.nom || row.username || "Étudiant";
                let realLastName = row.LastName || row.lastName || row.Prenom || row.prenom || "";
                
                if ((realFirstName === "Étudiant" || realFirstName === row.name) && !realLastName) {
                    realLastName = `(ID: ${row.InternID})`;
                }

                return {
                    FirstName: realFirstName,
                    LastName: realLastName,
                    Email: row.Email || row.email || "student@univ-tebessa.dz",
                    Status: row.Status || 'pending',
                    RegistrationDate: row.RegistrationDate,
                    InternID: row.InternID,
                    InternshipID: row.InternshipID,
                    RegistrationID: row.RegistrationID // مضاف لدعم عمليات الاتفاقيات بشكل دقيق
                };
            });

            console.log("📥 البيانات المرسلة للواجهة حية:", mappedResults);
            res.json(mappedResults);
        });
    });

    // 🔥 2. مسار القبول الفعلي المطور
    router.post('/applicants/accept', (req, res) => {
        const { email, internshipId } = req.body;
        console.log(`✅ طلب قبول الطالب: ${email} للعرض: ${internshipId}`);

        const query = `
            UPDATE registration r
            JOIN intern i ON r.InternID = i.InternID
            SET r.Status = 'Accepted'
            WHERE (i.Email = ? OR i.email = ?) AND r.InternshipID = ?
        `;

        db.query(query, [email, email, internshipId], (err, result) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true });
        });
    });

    // 🔥 3. مسار الرفض الفعلي المطور
    router.post('/applicants/reject', (req, res) => {
        const { email, internshipId } = req.body;
        console.log(`❌ طلب رفض الطالب: ${email} للعرض: ${internshipId}`);

        const query = `
            UPDATE registration r
            JOIN intern i ON r.InternID = i.InternID
            SET r.Status = 'Rejected'
            WHERE (i.Email = ? OR i.email = ?) AND r.InternshipID = ?
        `;

        db.query(query, [email, email, internshipId], (err, result) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true });
        });
    });

    // 🔒 مسار غلق عرض التربص نهائياً (PUT: /api/company/close-offer/:offerId)
    router.put('/close-offer/:offerId', checkRole(['company']), (req, res) => {
        const offerId = req.params.offerId;
        const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        console.log(`🔒 طلب غلق العرض رقم: ${offerId}`);

        const query = "UPDATE internship SET Statut = 'Closed' WHERE InternshipID = ?";
        
        db.query(query, [offerId], (err, result) => {
            if (err) {
                console.error("❌ خطأ أثناء غلق العرض في قاعدة البيانات:", err.message);
                if (auditLogger) auditLogger.error(`ECHEC CLOTURE OFFRE - Offre ID: ${offerId} - Erreur: ${err.message}`);
                return res.status(500).json({ success: false, message: "Database error." });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: "Offer not found." });
            }

            if (auditLogger) auditLogger.info(`OFFRE CLOTUREE - Offre ID: ${offerId} - IP: ${ip}`);
            
            console.log(`✅ تم غلق العرض رقم ${offerId} في قاعدة البيانات بنجاح.`);
            res.json({ success: true, message: "Offer closed successfully!" });
        });
    });

    return router;
};