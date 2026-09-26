# خطة تنفيذ Backend لمنصة تعليمية متكاملة (Implementation Plan)

**الإصدار:** 1.0
**التاريخ:** أغسطس 2026
**النوع:** Backend Architecture & Implementation Plan

---

## جدول المحتويات

1. نظرة عامة على المشروع
2. الـ Tech Stack المقترح
3. معمارية النظام (System Architecture)
4. تصميم قاعدة البيانات (Database Schema)
5. موديول المصادقة والتسجيل (Auth & OTP)
6. موديول المستخدمين والبروفايل (Users & Profiles)
7. موديول الكورسات (Courses)
8. موديول الدروس والمحتوى (Lessons & Content)
9. موديول الدفع (Payment System)
10. موديول الداشبورد (Dashboards)
11. موديول الامتحانات (Exams & Quizzes)
12. الحماية والأمان (Security)
13. الإشعارات (Notifications)
14. خطة المراحل الزمنية (Roadmap / Phases)
15. حاجات إضافية مقترحة (Nice to Have)

---

## 1. نظرة عامة على المشروع

منصة تعليمية إلكترونية (E-Learning Platform) تخدم فئتين أساسيتين من المستخدمين:

| النوع | الوصف |
|---|---|
| **Student (طالب)** | يسجل حساب بنفسه، يشترك في كورسات، يشاهد محتوى، يدخل امتحانات |
| **Teacher (مدرس)** | يُنشأ حسابه بواسطة الـ Admin فقط، يرفع كورسات ودروس، يدير الاشتراكات والمدفوعات، ينشئ امتحانات |
| **Admin** | يدير المدرسين والمنصة بالكامل |

**الهدف الأساسي:** نظام Backend قوي، آمن، قابل للتوسع (Scalable)، يخدم عدد كبير من الطلاب والمدرسين بدون مشاكل في الأداء أو الحماية.

---

## 2. الـ Tech Stack المقترح

| الطبقة | التقنية | السبب |
|---|---|---|
| Backend Framework | **NestJS** (Node.js + TypeScript) | بنية Modular جاهزة، Guards، Interceptors، DI مدمج |
| Database | **PostgreSQL** | علاقات معقدة (Course → Lesson → Exam → Payment) تحتاج Relational DB قوي |
| ORM | **Prisma** أو TypeORM | Migration management وType Safety |
| Cache / Queue | **Redis** | تخزين OTP، Rate Limiting، Session، Job Queue |
| Queue Processing | **BullMQ** (فوق Redis) | إرسال SMS/Email بشكل غير متزامن، توليد PDF |
| Object Storage | **AWS S3 / Backblaze B2** | تخزين الفيديوهات، الصور، ملفات PDF |
| Video Delivery | **HLS (HTTP Live Streaming)** | تقطيع الفيديو + Signed URLs مؤقتة لمنع السرقة |
| Auth | **JWT (Access + Refresh)** + OTP | حماية عالية + تحقق فعلي من رقم الموبايل |
| SMS Gateway | **Msegat / 4jawaly / Twilio** | إرسال رسائل OTP |
| PDF Generation | **Puppeteer** | توليد نتائج الامتحانات والشهادات كـ PDF |
| Real-time | **WebSockets (Socket.IO)** | إشعارات فورية (قبول الدفع، بداية امتحان) |
| API Documentation | **Swagger / OpenAPI** | توثيق كل الـ Endpoints |
| Containerization | **Docker + Docker Compose** | بيئة تطوير وإنتاج موحدة |

---

## 3. معمارية النظام (System Architecture)

### مبدأ التصميم: Modular Monolith
نبدأ بـ Monolith منظم بشكل Modules منفصلة (كل موديول مستقل تمامًا بـ Controllers/Services/Repositories خاصة به)، بحيث لو المشروع كبر مستقبلًا يسهل تحويل أي موديول إلى Microservice منفصل بدون إعادة كتابة.

```
src/
 ├── auth/              (تسجيل، دخول، OTP، JWT)
 ├── users/             (Students, Teachers, Admin profiles)
 ├── courses/           (CRUD الكورسات)
 ├── lessons/           (الدروس + الفيديوهات + الملفات)
 ├── enrollments/        (اشتراك الطالب في الكورس)
 ├── payments/          (فودافون كاش + مراجعة الإيصالات)
 ├── exams/             (الامتحانات والأسئلة والنتائج)
 ├── progress/          (تتبع تقدم الطالب)
 ├── notifications/     (إشعارات فورية + SMS + Email)
 ├── dashboard/         (تجميع بيانات لكل نوع مستخدم)
 ├── common/            (Guards, Interceptors, Decorators, Pipes)
 └── shared/            (S3 service, Redis service, PDF service)
```

### تدفق الطلب (Request Lifecycle)
```
Client → Rate Limiter → JWT Guard → Role Guard → Controller
       → Service (Business Logic) → Repository (DB)
       → Response Interceptor (تنسيق الرد) → Client
```

---

## 4. تصميم قاعدة البيانات (Database Schema)

### 4.1 جدول المستخدمين الأساسي

```sql
User {
  id: UUID (PK)
  email: string (unique)
  password_hash: string
  phone: string
  role: enum [student, teacher, admin]
  is_verified: boolean (default: false)
  is_active: boolean (default: true)
  created_at: timestamp
  updated_at: timestamp
}
```

### 4.2 بروفايل الطالب

```sql
StudentProfile {
  id: UUID (PK)
  user_id: UUID (FK → User)
  full_name: string
  guardian_phone: string      -- رقم ولي الأمر
  grade_level: enum [prep1, prep2, prep3, sec1, sec2, sec3_scientific, sec3_literary]
  created_at: timestamp
}
```

### 4.3 بروفايل المدرس

```sql
TeacherProfile {
  id: UUID (PK)
  user_id: UUID (FK → User)
  full_name: string
  specialization: string        -- التخصص
  photo_url: string
  address: string
  bio: text                     -- الوصف
  extra_info: text              -- معلومات إضافية
  work_places: string[]         -- السناتر/الأماكن التي يعمل بها
  created_by_admin_id: UUID (FK → User)
  created_at: timestamp
}
```

### 4.4 الكورسات

```sql
Course {
  id: UUID (PK)
  teacher_id: UUID (FK → TeacherProfile)
  title: string
  description: text
  thumbnail_url: string
  price: decimal
  is_free: boolean
  grade_level: enum [prep1, prep2, prep3, sec1, sec2, sec3_scientific, sec3_literary]
  status: enum [draft, published, archived]
  created_at: timestamp
  updated_at: timestamp
}
```

### 4.5 الدروس (Lessons)

```sql
Lesson {
  id: UUID (PK)
  course_id: UUID (FK → Course)
  title: string
  description: text
  order_index: int              -- ترتيب الدرس داخل الكورس
  video_url: string (HLS master playlist)
  duration_seconds: int
  is_preview: boolean            -- يظهر مجانًا كمعاينة حتى لو الكورس مدفوع
  created_at: timestamp
}
```

### 4.6 الملفات المرفقة (PDFs/Materials)

```sql
Material {
  id: UUID (PK)
  lesson_id: UUID (FK → Lesson, nullable)
  course_id: UUID (FK → Course, nullable)
  title: string
  file_url: string
  file_type: enum [pdf, doc, other]
  created_at: timestamp
}
```

### 4.7 الاشتراك (Enrollment)

```sql
Enrollment {
  id: UUID (PK)
  student_id: UUID (FK → StudentProfile)
  course_id: UUID (FK → Course)
  status: enum [pending, active, rejected]
  enrolled_at: timestamp
  activated_at: timestamp (nullable)
}
```

### 4.8 المدفوعات

```sql
Payment {
  id: UUID (PK)
  enrollment_id: UUID (FK → Enrollment)
  amount: decimal
  receipt_image_url: string
  status: enum [pending, accepted, rejected]
  rejection_reason: string (nullable)
  reviewed_by: UUID (FK → User, nullable)
  reviewed_at: timestamp (nullable)
  created_at: timestamp
}
```

### 4.9 تتبع التقدم

```sql
Progress {
  id: UUID (PK)
  student_id: UUID (FK → StudentProfile)
  lesson_id: UUID (FK → Lesson)
  watched_percentage: int (0-100)
  is_completed: boolean
  last_watched_at: timestamp
}
```

### 4.10 الامتحانات

```sql
Exam {
  id: UUID (PK)
  course_id: UUID (FK → Course)
  title: string
  start_at: timestamp
  end_at: timestamp
  duration_minutes: int
  total_marks: int
  created_at: timestamp
}

Question {
  id: UUID (PK)
  exam_id: UUID (FK → Exam)
  text: text
  options: JSON  -- ["اختيار 1", "اختيار 2", "اختيار 3", "اختيار 4"]
  correct_option_index: int
  order_index: int
  marks: int
}

ExamAttempt {
  id: UUID (PK)
  exam_id: UUID (FK → Exam)
  student_id: UUID (FK → StudentProfile)
  started_at: timestamp
  submitted_at: timestamp (nullable)
  score: int (nullable)
  status: enum [in_progress, submitted, expired]
}

AttemptAnswer {
  id: UUID (PK)
  attempt_id: UUID (FK → ExamAttempt)
  question_id: UUID (FK → Question)
  selected_option_index: int
  is_correct: boolean
}
```

---

## 5. موديول المصادقة والتسجيل (Auth Module)

### 5.1 تسجيل الطالب (Student Registration)

**الخطوات:**
1. `POST /auth/student/register` — يرسل البيانات (الاسم، الإيميل، موبايله، موبايل ولي الأمر، الباسورد، الصف الدراسي)
2. السيرفر يتحقق من عدم تكرار الإيميل/الموبايل
3. يُنشأ سجل User بحالة `is_verified = false`
4. يُولّد كود OTP (6 أرقام) ويُخزّن في Redis مع صلاحية دقيقتين، ويُربط برقم الموبايل
5. يُرسل الكود عبر SMS Gateway
6. `POST /auth/verify-otp` — الطالب يدخل الكود
7. لو الكود صحيح: `is_verified = true`، ويُرجع للطالب JWT tokens مباشرة
8. لو خطأ 3 مرات: قفل مؤقت (Rate Limit) لمدة 15 دقيقة

### 5.2 إنشاء حساب المدرس (بواسطة Admin فقط)

- `POST /admin/teachers` — endpoint محمي بـ `Role: admin` فقط
- البيانات: الاسم، التخصص، الإيميل، الموبايل، الباسورد، صورة، عنوان، وصف، معلومات إضافية، أماكن العمل/السناتر
- لا يحتاج OTP لأن الأدمن هو من يُنشئه مباشرة بحالة `is_verified = true`
- يُرسل للمدرس إيميل ترحيبي فيه بيانات الدخول (اختياري: يُجبر على تغيير الباسورد أول مرة)

### 5.3 تسجيل الدخول (Login)

- `POST /auth/login` — إيميل + باسورد (موحّد لكل الأنواع)
- التحقق من `bcrypt` hash
- إصدار Access Token (15 دقيقة) + Refresh Token (7 أيام، مخزّن كـ httpOnly Secure Cookie)
- تسجيل الجهاز/الـ IP في جدول Sessions (لإمكانية إبطال الجلسات لاحقًا)

### 5.4 تسجيل الخروج (Logout)

- `POST /auth/logout` — إبطال الـ Refresh Token الحالي من قاعدة البيانات/Redis

### 5.5 تجديد التوكن (Refresh Token Rotation)

- `POST /auth/refresh` — كل مرة يُصدر Refresh Token جديد ويُلغى القديم
- لو تم استخدام توكن مُلغى بالفعل (إعادة استخدام) → إبطال كل جلسات المستخدم فورًا (اشتباه سرقة توكن)

---

## 6. موديول المستخدمين والبروفايل

### الطالب — `/profile` (GET)
يرجع:
- البيانات الشخصية + الإعدادات
- قائمة الكورسات المشترك فيها (نشطة/معلقة)
- إمكانية تعديل البيانات: `PATCH /profile`
- إمكانية تغيير الباسورد: `PATCH /profile/password`

### المدرس — `/profile` (GET)
يرجع:
- البيانات الشخصية الكاملة
- قائمة الكورسات التي أنشأها
- عدد المشتركين لكل كورس (`enrollment_count`)
- إجمالي الأرباح (اختياري - راجع القسم 15)

**صلاحيات المدرس:**
- `POST /courses` — إنشاء كورس
- `PATCH /courses/:id` — تعديل
- `DELETE /courses/:id` — حذف (Soft Delete)
- لا يقدر يعدّل/يشوف كورسات مدرس تاني (Guard على مستوى الـ Service: `course.teacher_id === currentUser.id`)

---

## 7. موديول الكورسات

### Endpoints الأساسية

| Method | Endpoint | الوصف | الصلاحية |
|---|---|---|---|
| GET | `/courses` | عرض كل الكورسات (فلترة حسب الصف الدراسي/مجاني-مدفوع) | عام |
| GET | `/courses/:id` | تفاصيل كورس معين | عام (المحتوى الكامل بعد الاشتراك فقط) |
| POST | `/courses` | إنشاء كورس جديد | Teacher |
| PATCH | `/courses/:id` | تعديل كورس | Teacher (owner فقط) |
| DELETE | `/courses/:id` | حذف كورس | Teacher (owner فقط) |
| POST | `/courses/:id/enroll-free` | اشتراك مباشر في كورس مجاني | Student |

### منطق الكورس المجاني (Free Course)
- لو `is_free = true` → عند الضغط على "احصل على الكورس"، يُنشأ `Enrollment` بحالة `active` فورًا بدون المرور بمرحلة الدفع.
- لو مدفوع → يُنشأ `Enrollment` بحالة `pending` وينتقل الطالب لصفحة Checkout.

### عرض الكورسات للطالب
- فلترة تلقائية حسب `grade_level` بتاع الطالب (تظهر كورسات صفه الدراسي افتراضيًا مع إمكانية تصفح الباقي)
- Badge واضح: "مجاني" / "السعر X جنيه" / "مشترك بالفعل"

---

## 8. موديول الدروس والمحتوى (Lessons)

### بنية العرض داخل الكورس
```
Course
 └── Lessons (مرتبة بـ order_index)
      ├── Lesson 1: فيديو + مدة + حالة (تم المشاهدة / لم يبدأ)
      ├── Lesson 2: ...
      └── Materials (PDFs مرتبطة بالكورس أو بدرس معين)
```

### Endpoints

| Method | Endpoint | الوصف | الصلاحية |
|---|---|---|---|
| POST | `/courses/:id/lessons` | إضافة درس جديد | Teacher (owner) |
| PATCH | `/lessons/:id` | تعديل درس | Teacher (owner) |
| DELETE | `/lessons/:id` | حذف درس | Teacher (owner) |
| POST | `/lessons/reorder` | تغيير ترتيب الدروس (drag & drop) | Teacher (owner) |
| GET | `/lessons/:id/stream-url` | الحصول على رابط تشغيل مؤقت (Signed URL) | Student (enrolled فقط) |
| POST | `/lessons/:id/progress` | تحديث نسبة المشاهدة | Student (enrolled فقط) |
| POST | `/courses/:id/materials` | رفع ملف PDF مرتبط | Teacher (owner) |

### آلية حماية الفيديو (تفصيل تقني)
1. الفيديو يُرفع من المدرس → يُعالج بـ FFmpeg على السيرفر لتحويله لصيغة HLS (عدة جودات: 360p/480p/720p)
2. يُخزّن على S3 كملفات `.m3u8` + `.ts` segments
3. عند طلب الطالب للفيديو:
   - `GET /lessons/:id/stream-url`
   - السيرفر يتحقق: هل `Enrollment.status = active` لنفس الطالب ونفس الكورس؟
   - لو نعم: يُولّد Signed URL صالح لمدة 10 دقائق فقط لكل segment
   - يُضاف Watermark ديناميكي (اسم/إيميل الطالب) فوق الفيديو أثناء التشغيل من الفرونت إند (Canvas overlay) لردع التصوير والمشاركة

---

## 9. موديول الدفع (Payment System)

### تدفق العملية بالكامل

```
1. الطالب يضيف كورس للعربة (Cart)
        ↓
2. POST /checkout → إنشاء Enrollment (status: pending)
   يُعرض للطالب: رقم فودافون كاش + المبلغ المطلوب + رقم مرجعي فريد (Order Reference)
        ↓
3. الطالب يحول الفلوس فعليًا على الرقم يدويًا
        ↓
4. POST /payments/:enrollmentId/submit-receipt
   يرفع صورة الوصل (multipart/form-data → S3)
   يُنشأ سجل Payment (status: pending)
        ↓
5. المدرس يفتح Dashboard → GET /teacher/payments?status=pending
   يشوف كل الطلبات المعلقة (صورة الوصل + اسم الطالب + المبلغ + الكورس)
        ↓
6a. Accept:
    PATCH /payments/:id/accept
    → Payment.status = accepted
    → Enrollment.status = active
    → إشعار فوري للطالب (WebSocket + SMS اختياري)
    → الطالب يقدر يدخل الكورس فورًا

6b. Reject:
    PATCH /payments/:id/reject { reason: "المبلغ غير مطابق" }
    → Payment.status = rejected
    → إشعار للطالب بالسبب
    → الطالب يقدر يرفع وصل جديد
```

### ضوابط أمان على الدفع
- منع تكرار رفع نفس الصورة (hash المقارنة) لأكتر من عملية
- Audit Log كامل: كل تغيير حالة (`pending → accepted/rejected`) يُسجَّل مع `reviewed_by` و`timestamp`
- الطالب لا يقدر يشوف محتوى الكورس إلا بعد `Enrollment.status = active` (Guard في كل endpoint خاص بالدروس)
- Rate limit على رفع الإيصالات (منع الإسبام)

---

## 10. موديول الداشبورد (Dashboard)

### داشبورد الطالب — `GET /dashboard/student`
```json
{
  "enrolled_courses": [
    {
      "course": {...},
      "progress_percentage": 65,
      "last_lesson_watched": "الدرس السابع",
      "completed_lessons": 7,
      "total_lessons": 12
    }
  ],
  "pending_payments": [...],
  "upcoming_exams": [...]
}
```

### داشبورد المدرس — `GET /dashboard/teacher`
```json
{
  "courses_summary": [
    {
      "course_id": "...",
      "title": "...",
      "total_enrollments": 120,
      "active_enrollments": 95,
      "pending_payments_count": 8
    }
  ],
  "pending_payments": [...],
  "recent_activity": [...]
}
```

### داشبورد الأدمن — `GET /dashboard/admin`
- إجمالي المدرسين، الطلاب، الكورسات، المدفوعات (عامة على مستوى المنصة)
- إدارة كاملة للمدرسين (تعطيل/تفعيل حساب)

---

## 11. موديول الامتحانات (Exams & Quizzes)

### إنشاء الامتحان (Teacher)
- `POST /courses/:id/exams` — تحديد العنوان، وقت البداية، وقت النهاية، مدة الامتحان بالدقائق
- `POST /exams/:id/questions` — إضافة سؤال (نص + 4 اختيارات + تحديد الإجابة الصحيحة + الدرجة)

### دخول الطالب للامتحان
1. الامتحان يظهر للطالب فقط بين `start_at` و `end_at`، وفقط لو `Enrollment.status = active`
2. `POST /exams/:id/start` → يُنشأ `ExamAttempt` بحالة `in_progress` مع `started_at` وقت السيرفر
3. المدة تُحسب من السيرفر وليس الفرونت إند: `deadline = started_at + duration_minutes`
4. **منع الغش:** جلسة واحدة فقط لكل طالب لكل امتحان (لو حاول يفتحه من تاب/جهاز تاني، يظهر تحذير أو يمنع)
5. `POST /exams/:id/submit` → يرسل إجابات الطالب، السيرفر يحسب النتيجة تلقائيًا بمقارنة `selected_option_index` بـ `correct_option_index`
6. لو انتهى الوقت ولم يُرسل الطالب → auto-submit عبر Cron Job/Queue Job مجدول

### عرض النتيجة
- `GET /exams/:id/result` — يرجع:
  - الدرجة الكلية
  - كل سؤال: إجابة الطالب / الإجابة الصحيحة / صح أو خطأ
- `GET /exams/:id/result/pdf` — توليد ملف PDF بالنتيجة الكاملة (عبر Puppeteer، Template HTML مصمم بشكل احترافي)

---

## 12. الحماية والأمان (Security)

| الإجراء | التفاصيل |
|---|---|
| **Password Hashing** | bcrypt (salt rounds ≥ 10) |
| **JWT** | Access Token قصير العمر + Refresh Token Rotation |
| **OTP** | صلاحية دقيقتين، محاولات محدودة (3)، قفل مؤقت بعدها |
| **Rate Limiting** | على `/auth/login`, `/auth/register`, `/auth/verify-otp` (عبر Redis) |
| **RBAC** | Guards على مستوى NestJS تمنع أي دور من الوصول لموارد ليست له |
| **Video Protection** | Signed URLs مؤقتة + Watermark + التحقق من Enrollment قبل كل طلب |
| **Input Validation** | DTO validation (class-validator) على كل طلب وارد |
| **CORS** | مقصور على الدومينات الرسمية للمنصة فقط |
| **HTTPS Only** | إجباري في الإنتاج |
| **SQL Injection / XSS** | محمي تلقائيًا عبر ORM + Sanitization على المدخلات النصية |
| **Audit Logs** | لكل عملية حساسة (دفع، حذف كورس، تعديل درجة امتحان) |
| **File Upload Validation** | فحص نوع وحجم الملفات (الصور/PDF فقط، حد أقصى للحجم) قبل الرفع لـ S3 |

---

## 13. الإشعارات (Notifications)

نظام إشعارات موحّد (Notification Service) يدعم عدة قنوات:

| الحدث | القناة |
|---|---|
| تسجيل حساب جديد | SMS (OTP) |
| قبول/رفض الدفع | WebSocket (فوري) + إشعار داخل التطبيق |
| اقتراب موعد امتحان | إشعار داخل التطبيق (قبل ساعة مثلاً) |
| درس جديد في كورس مشترك فيه | إشعار داخل التطبيق |
| رفع وصل جديد | إشعار للمدرس فورًا في الداشبورد |

يُنفَّذ عبر **BullMQ Queue** حتى لا يبطئ الـ Request الأساسي (Fire and forget pattern).

---

## 14. خطة المراحل الزمنية (Roadmap)

### Phase 1 — الأساسيات (2-3 أسابيع)
- إعداد المشروع (NestJS + PostgreSQL + Docker)
- موديول Auth الكامل (تسجيل طالب + OTP + دخول/خروج + JWT)
- إنشاء حساب المدرس بواسطة الأدمن
- موديول Users/Profile الأساسي

### Phase 2 — الكورسات والمحتوى (3-4 أسابيع)
- CRUD الكورسات الكامل
- موديول الدروس + رفع الفيديوهات + تحويل HLS
- موديول الملفات (PDFs)
- عرض الكورسات للطلاب مع الفلترة

### Phase 3 — الاشتراك والدفع (2-3 أسابيع)
- نظام Enrollment
- نظام Checkout وفودافون كاش
- داشبورد مراجعة المدفوعات للمدرس

### Phase 4 — التقدم والداشبوردات (2 أسابيع)
- نظام Progress Tracking
- داشبورد الطالب والمدرس والأدمن الكاملة

### Phase 5 — الامتحانات (3 أسابيع)
- إنشاء الامتحانات والأسئلة
- نظام الحضور والتوقيت من السيرفر
- التصحيح التلقائي وعرض النتائج
- توليد PDF

### Phase 6 — التحسينات والأمان النهائي (2 أسابيع)
- مراجعة أمنية شاملة (Security Audit)
- تحسين الأداء (Caching, Indexing)
- اختبار حمل (Load Testing)
- التوثيق الكامل (Swagger)

**إجمالي تقديري: 3-4 أشهر لفريق صغير (2-3 مطورين Backend)**

---

## 15. حاجات إضافية مقترحة (Nice to Have)

- **Wallet/أرباح المدرس**: صفحة تفصيلية بإجمالي الأرباح لكل كورس، مع سجل كامل للمدفوعات المقبولة.
- **Reviews & Ratings**: تقييم الطلاب للكورسات بعد الإكمال — يزيد الثقة للمشتركين الجدد.
- **Certificates**: شهادة إتمام PDF تلقائية عند اجتياز الكورس (وربما بعد اجتياز امتحان نهائي بنسبة معينة).
- **Coupons/كود خصم**: نظام أكواد خصم للكورسات المدفوعة.
- **Soft Delete**: عدم الحذف الفعلي لأي كورس/درس فيه طلاب مشتركين، فقط `is_deleted = true` مع إخفائه من الواجهة.
- **Admin Analytics**: تقارير شهرية عن نمو المنصة (عدد الطلاب الجدد، الإيرادات، أكثر الكورسات مبيعًا).
- **Multi-device session management**: الطالب يقدر يشوف الأجهزة المسجل دخول منها ويقدر يعمل logout عن بعد.
- **Search & Filters متقدمة**: بحث بالاسم/المدرس/السعر مع ترتيب (الأحدث، الأكثر شهرة).

---

## خلاصة

هذه الخطة تغطي كل الأفكار المطروحة بشكل منظم وقابل للتنفيذ التدريجي عبر مراحل واضحة، مع تصميم قاعدة بيانات علائقية سليمة، ونظام حماية متعدد الطبقات يتماشى مع حساسية المحتوى التعليمي المدفوع، ونظام دفع يدوي مناسب للسياق المحلي (فودافون كاش)، ونظام امتحانات يعتمد على توقيت السيرفر لمنع التلاعب.

يمكن البدء فورًا بـ **Phase 1** والانتقال بالتدريج، مع إمكانية تعديل الترتيب حسب أولويات العمل الفعلية.
