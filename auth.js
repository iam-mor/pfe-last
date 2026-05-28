const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt'); // 🔒 استدعاء مكتبة التشفير والتجزئة الآمنة

// 📁 التعديل هنا: استلام الـ db والـ auditLogger معاً من ملف server.js
module.exports = (db, auditLogger) => {

    // 1️⃣ رابط تسجيل الدخول المشترك (طالب / شركة / قسم)
    router.post('/login', (req, res) => {
        const { email, password } = req.body;
        const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        // أ) البحث عن الطالب في جدول الطلاب عبر البريد الإلكتروني أولاً
        const queryIntern = "SELECT * FROM intern WHERE Email = ?";
        db.query(queryIntern, [email], async (err, results) => {
            if (err) return res.status(500).json({ success: false, message: "خطأ في الخادم" });

            if (results.length > 0) {
                const student = results[0];
                
                // 🔐 المقارنة الرياضية الآمنة بين الكلمة المدخلة والبصمة المخزنة في قاعدة البيانات
                const isMatch = await bcrypt.compare(password, student.Password);
                if (isMatch) {
                    // 📁 تسجيل أثر دخول الطالب في نظام الـ Log
                    auditLogger.info(`CONNEXION REUSSIE - Rôle: Intern (ID: ${student.InternID || student.id}) - Email: ${email} - IP: ${ip}`);

                    return res.json({ 
                        success: true, 
                        role: 'intern', 
                        message: "مرحباً بك أيها المتربص! 🎓", 
                        user: {
                            id: student.InternID || student.id,
                            name: student.FirstName ? `${student.FirstName} ${student.LastName}` : (student.Name || "Student"),
                            email: student.Email,
                            ...student 
                        }
                    });
                }
            }

            // ب) إذا لم يجد الطالب أو كانت الكلمة خاطئة، يفحص في جدول الشركات
            const queryCompany = "SELECT * FROM company WHERE Email = ?";
            db.query(queryCompany, [email], async (err, results) => {
                if (err) return res.status(500).json({ success: false, message: "خطأ في الخادم" });

                if (results.length > 0) {
                    const company = results[0];
                    
                    // 🔐 مقارنة كلمة مرور الشركة مع البصمة المخزنة
                    const isMatch = await bcrypt.compare(password, company.Password);
                    if (isMatch) {
                        const finalName = company.Name || company.name || "Tech Company";
                        
                        // 📁 تسجيل أثر دخول الشركة في نظام الـ Log
                        auditLogger.info(`CONNEXION REUSSIE - Rôle: Company (ID: ${company.CompanyID || company.id}) - Nom: ${finalName} - IP: ${ip}`);

                        return res.json({ 
                            success: true, 
                            role: 'company', 
                            message: "مرحباً بكم يا فوت المنشأة! 🏢", 
                            user: {
                                id: company.CompanyID || company.id,
                                companyName: finalName,
                                name: finalName,
                                email: company.Email
                            }
                        });
                    }
                }

                // ج) إذا لم يجد الشركة، يفحص في جدول الأقسام (الإدارة)
                const queryDept = "SELECT * FROM department WHERE Email = ?";
                db.query(queryDept, [email], async (err, results) => {
                    if (err) return res.status(500).json({ success: false, message: "خطأ في الخادم" });

                    if (results.length > 0) {
                        const dept = results[0];
                        
                        // 🔐 مقارنة كلمة مرور إدارة القسم مع البصمة المخزنة
                        const isMatch = await bcrypt.compare(password, dept.Password);
                        if (isMatch) {
                            // 📁 تسجيل أثر دخول الإدارة في نظام الـ Log
                            auditLogger.info(`CONNEXION REUSSIE - Rôle: Department (ID: ${dept.DepartmentID || dept.id}) - Nom: ${dept.Name || "Admin"} - IP: ${ip}`);

                            return res.json({ 
                                success: true, 
                                role: 'department', 
                                message: "مرحباً بكم إدارة القسم! 🏛️", 
                                user: {
                                    id: dept.DepartmentID || dept.id,
                                    name: dept.Name || dept.DepartmentName || "Department Admin",
                                    email: dept.Email,
                                    ...dept
                                }
                            });
                        }
                    }

                    // د) إذا لم تتطابق كلمة المرور أو لم يجد البريد في أي جدول (محاولة دخول فشلت)
                    // 📁 تسجيل تحذير أمني بمحاولة الدخول الفاشلة ورصد عنوان الـ IP المتسبب بها
                    auditLogger.warn(`TENTATIVE DE CONNEXION ECHOUEE - Email tenté: ${email} - IP: ${ip}`);
                    return res.json({ success: false, message: "البريد الإلكتروني أو كلمة المرور غير صحيحة!" });
                });
            });
        });
    });

    // 2️⃣ رابط تسجيل الحسابات الجديد (Register)
    router.post('/register', async (req, res) => {
        const { firstName, lastName, email, phone, password, degree, specialization, dateOfBirth, role } = req.body;
        const saltRounds = 10; 
        const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        try {
            // أ) تسجيل حساب طالب (intern)
            if (role === 'intern' || !role) {
                const hashedPassword = await bcrypt.hash(password, saltRounds);

                const query = `
                    INSERT INTO intern (FirstName, LastName, DateOfBirth, Email, Password, Phone, Degree, CV) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, '')
                `;
                
                db.query(query, [firstName, lastName, dateOfBirth, email, hashedPassword, phone, degree], (err, result) => {
                    if (err) {
                        console.error("❌ الخطأ المفصل في قاعدة البيانات (طالب):", err);
                        return res.status(500).json({ success: false, message: "خطأ في قاعدة البيانات أثناء تسجيل الطالب." });
                    }
                    
                    // 📁 تسجيل أثر إنشاء حساب طالب جديد بنجاح
                    auditLogger.info(`INSCRIPTION REUSSIE - Rôle: Intern - Nom: ${firstName} ${lastName} - Email: ${email} - IP: ${ip}`);
                    return res.status(201).json({ success: true, message: "تم تسجيل حساب الطالب بنجاح في phpMyAdmin! 🎉" });
                });
            } 
            // ب) تسجيل حساب شركة (company)
            else if (role === 'company') {
                const { companyName, sector, address } = req.body;
                const hashedPassword = await bcrypt.hash(password, saltRounds);

                const query = `
                    INSERT INTO company (Name, Address, Email, Password, Sector) 
                    VALUES (?, ?, ?, ?, ?)
                `;
                
                db.query(query, [companyName, address, email, hashedPassword, sector], (err, result) => {
                    if (err) {
                        console.error("❌ الخطأ المفصل في قاعدة البيانات (شركة):", err);
                        return res.status(500).json({ success: false, message: "خطأ في قاعدة البيانات أثناء تسجيل الشركة." });
                    }

                    // 📁 تسجيل أثر إنشاء حساب شركة جديد بنجاح
                    auditLogger.info(`INSCRIPTION REUSSIE - Rôle: Company - Nom: ${companyName} - Secteur: ${sector} - Email: ${email} - IP: ${ip}`);

                    return res.status(201).json({ 
                        success: true, 
                        message: "تم تسجيل حساب الشركة بنجاح! 🎉",
                        role: 'company',
                        user: {
                            id: result.insertId, 
                            companyName: companyName,
                            name: companyName,
                            email: email,
                            sector: sector
                        }
                    });
                });
            }
        } catch (hashError) {
            console.error("❌ خطأ أثناء تشفير كلمة المرور:", hashError);
            return res.status(500).json({ success: false, message: "خطأ داخلي في الخادم أثناء التشفير." });
        }
    });

    return router;
};