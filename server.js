const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const helmet = require('helmet'); // 🔒 استدعاء درع حماية العناوين والـ Headers
const rateLimit = require('express-rate-limit'); // 🛑 استدعاء حارس منع هجمات DDoS والتخمين
const winston = require('winston'); // 📁 استدعاء مكتبة تسجيل ملفات الأثر وتتبع الحركة

const app = express();

// 📁 إعداد كاتب سجلات الأثر (Audit Logger) لحفظ الأنشطة في ملف نصي خارجي بلغة فرنسية احترافية
const auditLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] [${level.toUpperCase()}]: ${message}`;
        })
    ),
    transports: [
        // سيتم إنشاء هذا الملف تلقائياً في مجلد الـ backend
        new winston.transports.File({ filename: 'audit.log' })
    ],
});

// 1️⃣ تفعيل جدار حماية خوذة الأمان (Helmet) لحماية الـ HTTP Headers وإخفاء هويّة السيرفر
app.use(helmet()); 

app.use(cors());
app.use(express.json());

// 2️⃣ إعداد حارس تحديد معدل الطلبات (Rate Limiter) لمنع هجمات الـ Brute-Force على البوابات الحساسة
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // المدة الزمنيّة: 15 دقيقة
    max: 100, // أقصى عدد طلبات مسموح به من نفس جهاز الـ IP خلال هذه المدة
    message: { 
        success: false, 
        message: "⚠️ لقد تجاوزت حد الطلبات المسموح به من هذا الجهاز, يرجى المحاولة بعد 15 دقيقة." 
    },
    standardHeaders: true, // إرسال معلومات الحد في أسطر الـ RateLimit الحماية
    legacyHeaders: false, // تعطيل الأسطر القديمة غير الآمنة
});

// الاتصال بقاعدة البيانات
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'pfe-management'
});

db.connect(err => {
    if (err) {
        // تسجيل خطأ الاتصال في ملف الـ log
        auditLogger.error(`Connexion Base de données échouée: ${err.message}`);
        console.log("خطأ في الاتصال:", err);
    } else {
        // تسجيل نجاح الاتصال في ملف الـ log
        auditLogger.info("Connexion réussie à la base de données MySQL.");
        console.log("تم الاتصال بـ phpMyAdmin بنجاح! 🚀");
    }
});

// 🔗 التعديل الذكي هنا: تمرير الـ db ومعه الـ auditLogger لملف مسارات الـ auth
const authRoutes = require('./routes/auth')(db, auditLogger);
// 🛡️ تطبيق حارس الـ Rate Limiter على بوابة الدخول والتسجيل حصراً لتأمينها ضد المخترقين
app.use('/api', apiLimiter, authRoutes); 

const internRouter = require('./routes/intern')(db, auditLogger);
app.use('/api/intern', internRouter);

// 🚀 التعديل السحري هنا: استدعاء ملف الشركات الصحيح وتمرير الـ (db) له ليعمل بدون انهيار
const companyRouter = require('./routes/company')(db, auditLogger); 
app.use('/api/company', companyRouter);
// حيلة برمجية ذكية: جعل السيرفر يستمع للمسار المباشر أيضاً لتلبية طلب الواجهة فوراً
app.use('/api', require('./routes/company')(db, auditLogger));

// تفعيل روابط إدارة القسم وتمرير قاعدة البيانات لها بنجاح
const departmentRouter = require('./routes/department')(db, auditLogger);
app.use('/api/department', departmentRouter);

app.listen(5000, () => {
    // توثيق إقلاع النظام بنجاح
    auditLogger.info("Le serveur IFTMS a démarré sur le port 5000.");
    console.log("السيرفر يعمل على المنفذ 5000 وصمام الأمان مفعّل بالكامل 🛡️");
});