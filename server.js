const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'db.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (['pdf'].includes(ext)) return 'description';
  if (['mp3', 'wav', 'ogg'].includes(ext)) return 'music_note';
  if (['mp4', 'mov', 'avi'].includes(ext)) return 'videocam';
  if (['zip', 'rar', 'tar', 'gz'].includes(ext)) return 'archive';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image';
  if (['doc', 'docx'].includes(ext)) return 'edit';
  return 'insert_drive_file';
}

app.post('/api/upload', (req, res) => {
  const { name, data } = req.body || {};
  if (!name || !data) return res.status(400).json({ error: 'Name and data are required' });
  let base64 = data;
  if (base64.includes(',')) base64 = base64.split(',')[1];
  let buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch (e) {
    return res.status(400).json({ error: 'Invalid file data' });
  }
  if (buffer.length === 0) return res.status(400).json({ error: 'File is empty' });
  const ext = path.extname(name);
  const storedName = `${generateId('file')}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, storedName), buffer);
  res.status(201).json({
    name: path.basename(name),
    type: ext.replace('.', ''),
    icon: getFileIcon(name),
    path: `/uploads/${storedName}`,
    size: buffer.length
  });
});

app.get('/uploads/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(filepath) || !fs.statSync(filepath).isFile()) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.sendFile(filepath);
});

app.use(express.static(__dirname));

function readDB() {
  const data = fs.readFileSync(DB_PATH, 'utf8');
  return JSON.parse(data);
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(c => {
    const [key, ...val] = c.split('=');
    cookies[key.trim()] = val.join('=').trim();
  });
  return cookies;
}

function getSessionUser(req) {
  const db = readDB();
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies.sid;
  if (!sid) return null;
  const session = (db.sessions || []).find(s => s.id === sid);
  if (!session) return null;
  const user = db.accounts.find(a => a.id === session.accountId);
  return user || null;
}

// ========================
// AUTH ENDPOINTS
// ========================

app.post('/api/auth/signup', (req, res) => {
  const db = readDB();
  const { displayName, username, password } = req.body;
  if (!displayName || !username || !password) {
    return res.status(400).json({ error: 'Display name, username, and password are required' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }
  if (db.accounts.find(a => a.username === username)) {
    return res.status(409).json({ error: 'Username already taken' });
  }
  const initials = displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const account = {
    id: generateId('acc'),
    username,
    displayName,
    avatar: initials,
    bio: '',
    password: hashPassword(password),
    skillsOffered: [],
    skillsWanted: [],
    subscribers: 0,
    createdAt: new Date().toISOString()
  };
  db.accounts.push(account);

  const session = { id: generateId('sess'), accountId: account.id, createdAt: new Date().toISOString() };
  if (!db.sessions) db.sessions = [];
  db.sessions.push(session);

  writeDB(db);

  res.setHeader('Set-Cookie', `sid=${session.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`);
  const { password: _, ...safeAccount } = account;
  res.status(201).json(safeAccount);
});

app.post('/api/auth/login', (req, res) => {
  const db = readDB();
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const account = db.accounts.find(a => a.username === username);
  if (!account || account.password !== hashPassword(password)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const session = { id: generateId('sess'), accountId: account.id, createdAt: new Date().toISOString() };
  if (!db.sessions) db.sessions = [];
  db.sessions.push(session);
  writeDB(db);

  res.setHeader('Set-Cookie', `sid=${session.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`);
  const { password: _, ...safeAccount } = account;
  res.json(safeAccount);
});

app.get('/api/auth/me', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const { password: _, ...safeAccount } = user;
  res.json(safeAccount);
});

app.post('/api/auth/logout', (req, res) => {
  const db = readDB();
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies.sid;
  if (sid && db.sessions) {
    db.sessions = db.sessions.filter(s => s.id !== sid);
    writeDB(db);
  }
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

// ========================
// ACCOUNT ENDPOINTS
// ========================

app.get('/api/accounts/:id', (req, res) => {
  const db = readDB();
  const account = db.accounts.find(a => a.id === req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  const { password: _, ...safeAccount } = account;
  res.json(safeAccount);
});

app.get('/api/accounts', (req, res) => {
  const db = readDB();
  const safe = db.accounts.map(({ password, ...rest }) => rest);
  res.json(safe);
});

app.get('/api/accounts/:id/posts', (req, res) => {
  const db = readDB();
  const posts = db.posts.filter(p => p.authorId === req.params.id);
  res.json(posts);
});

app.patch('/api/accounts/:id', (req, res) => {
  const db = readDB();
  const account = db.accounts.find(a => a.id === req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  const user = getSessionUser(req);
  if (!user || user.id !== account.id) return res.status(403).json({ error: 'Not authorized' });
  const { avatarUrl, avatar, displayName, bio } = req.body;
  if (avatarUrl !== undefined) account.avatarUrl = avatarUrl;
  if (avatar !== undefined) account.avatar = avatar;
  if (displayName !== undefined) account.displayName = displayName;
  if (bio !== undefined) account.bio = bio;
  writeDB(db);
  const { password: _, ...safeAccount } = account;
  res.json(safeAccount);
});

// ========================
// POST ENDPOINTS
// ========================

app.get('/api/posts', (req, res) => {
  const db = readDB();
  const { authorId, limit, offset } = req.query;
  let posts = [...db.posts].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (authorId) posts = posts.filter(p => p.authorId === authorId);
  if (offset) posts = posts.slice(parseInt(offset));
  if (limit) posts = posts.slice(0, parseInt(limit));
  const accountMap = Object.fromEntries(db.accounts.map(a => [a.id, a]));
  const enriched = posts.map(p => {
    const { password: _, ...safeAuthor } = accountMap[p.authorId] || {};
    return { ...p, author: safeAuthor };
  });
  res.json(enriched);
});

app.get('/api/posts/:id', (req, res) => {
  const db = readDB();
  const post = db.posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const accountMap = Object.fromEntries(db.accounts.map(a => [a.id, a]));
  const { password: _, ...safeAuthor } = accountMap[post.authorId] || {};
  const comments = (post.comments || []).map(c => {
    const { password: __, ...safeCAuthor } = accountMap[c.authorId] || {};
    return { ...c, author: safeCAuthor };
  });
  res.json({ ...post, author: safeAuthor, comments });
});

app.post('/api/posts', (req, res) => {
  const db = readDB();
  const { authorId, title, body, image, files, tags } = req.body;
  if (!authorId || (!title && !body)) {
    return res.status(400).json({ error: 'Author ID and title or body required' });
  }
  const author = db.accounts.find(a => a.id === authorId);
  if (!author) return res.status(404).json({ error: 'Author not found' });
  const post = {
    id: generateId('post'),
    authorId,
    title: title || '',
    body: body || '',
    image: image || '',
    files: files || [],
    tags: tags || [],
    likes: 0,
    likedBy: [],
    comments: [],
    createdAt: new Date().toISOString()
  };
  db.posts.unshift(post);
  writeDB(db);
  res.status(201).json(post);
});

app.post('/api/posts/:id/like', (req, res) => {
  const db = readDB();
  const post = db.posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'User ID required' });
  const likedIndex = post.likedBy.indexOf(userId);
  if (likedIndex >= 0) {
    post.likedBy.splice(likedIndex, 1);
    post.likes = Math.max(0, post.likes - 1);
  } else {
    post.likedBy.push(userId);
    post.likes += 1;
  }
  writeDB(db);
  res.json({ likes: post.likes, liked: likedIndex < 0 });
});

app.post('/api/posts/:id/comments', (req, res) => {
  const db = readDB();
  const post = db.posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const { authorId, body } = req.body;
  if (!authorId || !body) return res.status(400).json({ error: 'Author ID and body required' });
  const author = db.accounts.find(a => a.id === authorId);
  if (!author) return res.status(404).json({ error: 'Author not found' });
  const comment = {
    id: generateId('c'),
    authorId,
    body,
    createdAt: new Date().toISOString()
  };
  post.comments.unshift(comment);
  writeDB(db);
  const { password: _, ...safeAuthor } = author;
  res.status(201).json({ ...comment, author: safeAuthor });
});

// ========================
// COURSE ENDPOINTS
// ========================

function recalcCourseProgress(course) {
  const lessons = course.lessons || [];
  const total = lessons.length;
  const completed = lessons.filter(l => l.completed).length;
  course.totalLessons = total;
  course.completedLessons = completed;
  course.progress = total > 0 ? Math.round((completed / total) * 100) : 0;
  if (course.progress === 100) course.status = 'completed';
  else if (course.progress > 0) course.status = 'in-progress';
  else course.status = 'not-started';
}

app.get('/api/courses', (req, res) => {
  const db = readDB();
  const { status } = req.query;
  let courses = db.courses;
    if (status) {
      const statuses = status.split(',');
      courses = courses.filter(c => statuses.includes(c.status || 'not-started'));
    }
  res.json(courses);
});

app.get('/api/courses/:id', (req, res) => {
  const db = readDB();
  const course = db.courses.find(c => c.id === req.params.id);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  const instructor = db.accounts.find(a => a.id === course.instructorId);
  const { password: _, ...safeInstructor } = instructor || {};
  res.json({ ...course, instructorAccount: safeInstructor });
});

app.post('/api/courses', (req, res) => {
  const db = readDB();
  const { title, instructorId, image, description, lessons } = req.body;
  if (!title || !instructorId) return res.status(400).json({ error: 'Title and instructorId required' });
  const instructor = db.accounts.find(a => a.id === instructorId);
  const courseLessons = (lessons || []).map((l, i) => ({
    id: generateId('l'),
    title: l.title || 'Untitled Lesson',
    body: l.body || '',
    order: i,
    completed: false
  }));
  const course = {
    id: generateId('course'),
    title,
    instructor: instructor ? instructor.displayName : 'Unknown',
    instructorId,
    image: image || 'https://placehold.co/800x400/1e293b/00EBA9?text=' + encodeURIComponent(title),
    description: description || '',
    lessons: courseLessons,
    totalLessons: courseLessons.length,
    completedLessons: 0,
    progress: 0,
    status: 'not-started'
  };
  db.courses.push(course);
  writeDB(db);
  res.status(201).json(course);
});

app.patch('/api/courses/:id', (req, res) => {
  const db = readDB();
  const course = db.courses.find(c => c.id === req.params.id);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  const { title, description, image, lessons } = req.body;
  if (title !== undefined) course.title = title;
  if (description !== undefined) course.description = description;
  if (image !== undefined) course.image = image;
  if (lessons !== undefined) {
    course.lessons = lessons.map((l, i) => ({
      id: l.id || generateId('l'),
      title: l.title || 'Untitled Lesson',
      body: l.body || '',
      order: i,
      completed: l.completed || false
    }));
  }
  recalcCourseProgress(course);
  writeDB(db);
  res.json(course);
});

app.patch('/api/courses/:id/lessons/:lessonId', (req, res) => {
  const db = readDB();
  const course = db.courses.find(c => c.id === req.params.id);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  const lesson = (course.lessons || []).find(l => l.id === req.params.lessonId);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
  const { completed, title, body } = req.body;
  if (completed !== undefined) lesson.completed = completed;
  if (title !== undefined) lesson.title = title;
  if (body !== undefined) lesson.body = body;
  recalcCourseProgress(course);
  writeDB(db);
  res.json(course);
});

app.delete('/api/courses/:id', (req, res) => {
  const db = readDB();
  const idx = db.courses.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Course not found' });
  db.courses.splice(idx, 1);
  writeDB(db);
  res.json({ ok: true });
});

// Legacy endpoint (kept for backward compat)
app.get('/api/current-user', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const { password: _, ...safeAccount } = user;
  res.json(safeAccount);
});

app.listen(PORT, () => {
  console.log(`Skill Loop API server running on http://localhost:${PORT}`);
});
