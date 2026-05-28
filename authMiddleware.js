// authMiddleware.js

// دالة وسيطة للتحقق من هوية وصلاحية المستخدم (طالب، قسم، شركة)
const checkRole = (allowedRoles) => {
    return (req, res, next) => {
        // قراءة الدور (Role) القادم من الواجهة عبر الـ Headers لأمان أعلى
        const userRole = req.headers['user-role']; 

        // 1. التحقق من أن المستخدم قام بتسجيل الدخول أولاً
        if (!userRole) {
            return res.status(401).json({ 
                success: false, 
                message: "Unauthorized: Access denied. Please log in first." 
            });
        }

        // 2. التحقق من أن دور المستخدم يمتلك الصلاحية لدخول هذه الصفحة بالذات
        if (!allowedRoles.includes(userRole.toLowerCase().trim())) {
            return res.status(403).json({ 
                success: false, 
                message: "Forbidden: You do not have permission to view this resource." 
            });
        }

        // إذا نجح الفحص، يتم السماح للمستخدم بالمرور للمسار المطلوب
        next();
    };
};

module.exports = checkRole;