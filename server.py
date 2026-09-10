#!/usr/bin/env python3
import json
import os
import sys
import hashlib
import time
import random
import base64
import mimetypes
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timezone

DB_PATH = os.path.join(os.path.dirname(__file__), 'db.json')
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), 'uploads')
os.makedirs(UPLOAD_DIR, exist_ok=True)
PORT = 3000

def icon_for_filename(name):
    ext = name.split('.')[-1].lower() if '.' in name else ''
    if ext == 'pdf': return 'description'
    if ext in ('mp3', 'wav', 'ogg'): return 'music_note'
    if ext in ('mp4', 'mov', 'avi'): return 'videocam'
    if ext in ('zip', 'rar', 'tar', 'gz'): return 'archive'
    if ext in ('jpg', 'jpeg', 'png', 'gif', 'webp'): return 'image'
    if ext in ('doc', 'docx'): return 'edit'
    return 'insert_drive_file'

def read_db():
    with open(DB_PATH, 'r') as f:
        return json.load(f)

def write_db(data):
    with open(DB_PATH, 'w') as f:
        json.dump(data, f, indent=2)

def generate_id(prefix):
    return f"{prefix}_{int(time.time()*1000)}_{random.randint(10000, 99999)}"

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def get_iso_time():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

def parse_cookies(cookie_header):
    cookies = {}
    if not cookie_header:
        return cookies
    for part in cookie_header.split(';'):
        key, _, val = part.strip().partition('=')
        cookies[key.strip()] = val.strip()
    return cookies

def get_session_user(db, cookie_header):
    cookies = parse_cookies(cookie_header)
    sid = cookies.get('sid')
    if not sid:
        return None
    session = next((s for s in db.get('sessions', []) if s['id'] == sid), None)
    if not session:
        return None
    user = next((a for a in db['accounts'] if a['id'] == session['accountId']), None)
    return user

def safe_account(account):
    return {k: v for k, v in account.items() if k != 'password'}


class APIHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.dirname(__file__), **kwargs)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def set_cookie(self, name, value, max_age=None, path='/'):
        cookie = f"{name}={value}; Path={path}; HttpOnly; SameSite=Lax"
        if max_age is not None:
            cookie += f"; Max-Age={max_age}"
        elif value == '' or value is None:
            cookie += "; Max-Age=0"
        self.send_header('Set-Cookie', cookie)

    def parse_body(self):
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length:
            return json.loads(self.rfile.read(content_length).decode())
        return {}

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        # ---- AUTH ----
        if path == '/api/auth/me':
            db = read_db()
            user = get_session_user(db, self.headers.get('Cookie'))
            if user:
                self.send_json(safe_account(user))
            else:
                self.send_json({'error': 'Not authenticated'}, 401)

        # ---- ACCOUNTS ----
        elif path == '/api/accounts':
            db = read_db()
            self.send_json([safe_account(a) for a in db['accounts']])
        elif path.startswith('/api/accounts/') and '/posts' in path:
            account_id = path.split('/')[3]
            db = read_db()
            posts = [p for p in db['posts'] if p['authorId'] == account_id]
            self.send_json(posts)
        elif path.startswith('/api/accounts/') and path.count('/') == 3:
            account_id = path.split('/')[-1]
            db = read_db()
            account = next((a for a in db['accounts'] if a['id'] == account_id), None)
            if account:
                self.send_json(safe_account(account))
            else:
                self.send_json({'error': 'Account not found'}, 404)

        # ---- POSTS ----
        elif path == '/api/posts':
            db = read_db()
            accounts = {a['id']: a for a in db['accounts']}
            posts = sorted(db['posts'], key=lambda p: p['createdAt'], reverse=True)
            author_id = query.get('authorId', [None])[0]
            if author_id:
                posts = [p for p in posts if p['authorId'] == author_id]
            limit = query.get('limit', [None])[0]
            offset = query.get('offset', [None])[0]
            if offset:
                posts = posts[int(offset):]
            if limit:
                posts = posts[:int(limit)]
            enriched = []
            for p in posts:
                author = accounts.get(p['authorId'], {})
                enriched.append({**p, 'author': safe_account(author)})
            self.send_json(enriched)
        elif path.startswith('/api/posts/') and '/comments' not in path and '/like' not in path:
            post_id = path.split('/')[-1]
            db = read_db()
            post = next((p for p in db['posts'] if p['id'] == post_id), None)
            if post:
                accounts = {a['id']: a for a in db['accounts']}
                author = accounts.get(post['authorId'], {})
                comments = []
                for c in post.get('comments', []):
                    c_author = accounts.get(c.get('authorId'), {})
                    comments.append({**c, 'author': safe_account(c_author)})
                self.send_json({**post, 'author': safe_account(author), 'comments': comments})
            else:
                self.send_json({'error': 'Post not found'}, 404)

        # ---- COURSES ----
        elif path == '/api/courses':
            db = read_db()
            courses = db['courses']
            status = query.get('status', [None])[0]
            if status:
                statuses = status.split(',')
                courses = [c for c in courses if c.get('status', 'not-started') in statuses]
            self.send_json(courses)
        elif path.startswith('/api/courses/') and path.count('/') == 3:
            course_id = path.split('/')[-1]
            db = read_db()
            course = next((c for c in db['courses'] if c['id'] == course_id), None)
            if course:
                instructor = next((a for a in db['accounts'] if a['id'] == course.get('instructorId')), None)
                self.send_json({**course, 'instructorAccount': safe_account(instructor) if instructor else None})
            else:
                self.send_json({'error': 'Course not found'}, 404)

        # ---- LEGACY ----
        elif path == '/api/current-user':
            db = read_db()
            user = get_session_user(db, self.headers.get('Cookie'))
            if user:
                self.send_json(safe_account(user))
            else:
                self.send_json({'error': 'Not authenticated'}, 401)

        # ---- UPLOADS ----
        elif path.startswith('/uploads/'):
            filename = os.path.basename(path)
            file_path = os.path.join(UPLOAD_DIR, filename)
            if not os.path.isfile(file_path):
                self.send_json({'error': 'File not found'}, 404)
                return
            mime = mimetypes.guess_type(file_path)[0] or 'application/octet-stream'
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(os.path.getsize(file_path)))
            self.end_headers()
            with open(file_path, 'rb') as f:
                self.wfile.write(f.read())

        else:
            # Serve static files
            if path == '/' or path == '':
                self.path = '/index.html'
            return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        body = self.parse_body()

        # ---- AUTH: SIGNUP ----
        if path == '/api/auth/signup':
            db = read_db()
            display_name = body.get('displayName', '').strip()
            username = body.get('username', '').strip()
            password = body.get('password', '')
            if not display_name or not username or not password:
                self.send_json({'error': 'Display name, username, and password are required'}, 400)
                return
            if len(password) < 4:
                self.send_json({'error': 'Password must be at least 4 characters'}, 400)
                return
            if any(a['username'] == username for a in db['accounts']):
                self.send_json({'error': 'Username already taken'}, 409)
                return
            initials = ''.join(w[0] for w in display_name.split() if w).upper()[:2]
            account = {
                'id': generate_id('acc'),
                'username': username,
                'displayName': display_name,
                'avatar': initials,
                'bio': '',
                'password': hash_password(password),
                'skillsOffered': [],
                'skillsWanted': [],
                'subscribers': 0,
                'createdAt': get_iso_time()
            }
            db['accounts'].append(account)
            session = {'id': generate_id('sess'), 'accountId': account['id'], 'createdAt': get_iso_time()}
            if 'sessions' not in db:
                db['sessions'] = []
            db['sessions'].append(session)
            write_db(db)
            self.send_response(201)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.set_cookie('sid', session['id'], max_age=7*24*60*60)
            self.end_headers()
            self.wfile.write(json.dumps(safe_account(account)).encode())

        # ---- AUTH: LOGIN ----
        elif path == '/api/auth/login':
            db = read_db()
            username = body.get('username', '').strip()
            password = body.get('password', '')
            if not username or not password:
                self.send_json({'error': 'Username and password are required'}, 400)
                return
            account = next((a for a in db['accounts'] if a['username'] == username), None)
            if not account or account['password'] != hash_password(password):
                self.send_json({'error': 'Invalid username or password'}, 401)
                return
            session = {'id': generate_id('sess'), 'accountId': account['id'], 'createdAt': get_iso_time()}
            if 'sessions' not in db:
                db['sessions'] = []
            db['sessions'].append(session)
            write_db(db)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.set_cookie('sid', session['id'], max_age=7*24*60*60)
            self.end_headers()
            self.wfile.write(json.dumps(safe_account(account)).encode())

        # ---- AUTH: LOGOUT ----
        elif path == '/api/auth/logout':
            db = read_db()
            cookies = parse_cookies(self.headers.get('Cookie'))
            sid = cookies.get('sid')
            if sid and 'sessions' in db:
                db['sessions'] = [s for s in db['sessions'] if s['id'] != sid]
                write_db(db)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.set_cookie('sid', '', max_age=0)
            self.end_headers()
            self.wfile.write(json.dumps({'ok': True}).encode())

        # ---- POSTS ----
        elif path == '/api/posts':
            db = read_db()
            required = ['authorId']
            if not all(k in body for k in required) or not (body.get('title') or body.get('body')):
                self.send_json({'error': 'Author ID and title or body required'}, 400)
                return
            author = next((a for a in db['accounts'] if a['id'] == body['authorId']), None)
            if not author:
                self.send_json({'error': 'Author not found'}, 404)
                return
            post = {
                'id': generate_id('post'),
                'authorId': body['authorId'],
                'title': body.get('title', ''),
                'body': body.get('body', ''),
                'image': body.get('image', ''),
                'files': body.get('files', []),
                'tags': body.get('tags', []),
                'likes': 0,
                'likedBy': [],
                'comments': [],
                'createdAt': get_iso_time()
            }
            db['posts'].insert(0, post)
            write_db(db)
            self.send_json(post, 201)
        elif path.startswith('/api/posts/') and path.endswith('/like'):
            post_id = path.split('/')[-2]
            db = read_db()
            post = next((p for p in db['posts'] if p['id'] == post_id), None)
            if not post:
                self.send_json({'error': 'Post not found'}, 404)
                return
            user_id = body.get('userId')
            if not user_id:
                self.send_json({'error': 'User ID required'}, 400)
                return
            liked_idx = post['likedBy'].index(user_id) if user_id in post['likedBy'] else -1
            if liked_idx >= 0:
                post['likedBy'].pop(liked_idx)
                post['likes'] = max(0, post['likes'] - 1)
                liked = False
            else:
                post['likedBy'].append(user_id)
                post['likes'] += 1
                liked = True
            write_db(db)
            self.send_json({'likes': post['likes'], 'liked': liked})
        elif path.startswith('/api/posts/') and path.endswith('/comments'):
            post_id = path.split('/')[-2]
            db = read_db()
            post = next((p for p in db['posts'] if p['id'] == post_id), None)
            if not post:
                self.send_json({'error': 'Post not found'}, 404)
                return
            author_id = body.get('authorId')
            comment_body = body.get('body')
            if not author_id or not comment_body:
                self.send_json({'error': 'Author ID and body required'}, 400)
                return
            author = next((a for a in db['accounts'] if a['id'] == author_id), None)
            if not author:
                self.send_json({'error': 'Author not found'}, 404)
                return
            comment = {
                'id': generate_id('c'),
                'authorId': author_id,
                'body': comment_body,
                'createdAt': get_iso_time()
            }
            post['comments'].insert(0, comment)
            write_db(db)
            self.send_json({**comment, 'author': safe_account(author)}, 201)

        # ---- UPLOAD ----
        elif path == '/api/upload':
            name = body.get('name', '')
            data = body.get('data', '')
            if not name or not data:
                self.send_json({'error': 'Name and data are required'}, 400)
                return
            if ',' in data:
                data = data.split(',', 1)[1]
            try:
                raw = base64.b64decode(data)
            except Exception:
                self.send_json({'error': 'Invalid file data'}, 400)
                return
            if not raw:
                self.send_json({'error': 'File is empty'}, 400)
                return
            ext = os.path.splitext(name)[1]
            stored_name = f"{generate_id('file')}{ext}"
            file_path = os.path.join(UPLOAD_DIR, stored_name)
            with open(file_path, 'wb') as f:
                f.write(raw)
            self.send_json({
                'name': os.path.basename(name),
                'type': ext.lstrip('.'),
                'icon': icon_for_filename(name),
                'path': f'/uploads/{stored_name}',
                'size': len(raw)
            }, 201)

        # ---- COURSES ----
        elif path == '/api/courses':
            db = read_db()
            if not body.get('title') or not body.get('instructorId'):
                self.send_json({'error': 'Title and instructorId required'}, 400)
                return
            instructor = next((a for a in db['accounts'] if a['id'] == body['instructorId']), None)
            raw_lessons = body.get('lessons', [])
            course_lessons = [
                {'id': generate_id('l'), 'title': l.get('title', 'Untitled'), 'body': l.get('body', ''), 'order': i, 'completed': False}
                for i, l in enumerate(raw_lessons)
            ]
            course = {
                'id': generate_id('course'),
                'title': body['title'],
                'instructor': instructor['displayName'] if instructor else 'Unknown',
                'instructorId': body['instructorId'],
                'image': body.get('image', 'https://placehold.co/800x400/1e293b/00EBA9?text=' + body['title'].replace(' ', '+')),
                'description': body.get('description', ''),
                'lessons': course_lessons,
                'totalLessons': len(course_lessons),
                'completedLessons': 0,
                'progress': 0,
                'status': 'not-started'
            }
            db['courses'].append(course)
            write_db(db)
            self.send_json(course, 201)
        elif path.startswith('/api/courses/') and path.count('/') == 4 and 'lessons' in path:
            parts = path.split('/')
            course_id = parts[3]
            lesson_id = parts[5]
            db = read_db()
            course = next((c for c in db['courses'] if c['id'] == course_id), None)
            if not course:
                self.send_json({'error': 'Course not found'}, 404)
                return
            lesson = next((l for l in course.get('lessons', []) if l['id'] == lesson_id), None)
            if not lesson:
                self.send_json({'error': 'Lesson not found'}, 404)
                return
            if 'completed' in body:
                lesson['completed'] = body['completed']
            if 'title' in body:
                lesson['title'] = body['title']
            if 'body' in body:
                lesson['body'] = body['body']
            total = len(course.get('lessons', []))
            completed = len([l for l in course['lessons'] if l.get('completed')])
            course['totalLessons'] = total
            course['completedLessons'] = completed
            course['progress'] = round((completed / total) * 100) if total > 0 else 0
            course['status'] = 'completed' if course['progress'] == 100 else ('in-progress' if course['progress'] > 0 else 'not-started')
            write_db(db)
            self.send_json(course)
        else:
            self.send_json({'error': 'Not found'}, 404)

    def do_PATCH(self):
        parsed = urlparse(self.path)
        path = parsed.path
        body = self.parse_body()

        if path.startswith('/api/courses/') and path.count('/') == 3:
            course_id = path.split('/')[-1]
            db = read_db()
            course = next((c for c in db['courses'] if c['id'] == course_id), None)
            if not course:
                self.send_json({'error': 'Course not found'}, 404)
                return
            if 'title' in body:
                course['title'] = body['title']
            if 'description' in body:
                course['description'] = body['description']
            if 'image' in body:
                course['image'] = body['image']
            if 'lessons' in body:
                course['lessons'] = [
                    {'id': l.get('id', generate_id('l')), 'title': l.get('title', 'Untitled'), 'body': l.get('body', ''), 'order': i, 'completed': l.get('completed', False)}
                    for i, l in enumerate(body['lessons'])
                ]
                total = len(course['lessons'])
                completed = len([l for l in course['lessons'] if l.get('completed')])
                course['totalLessons'] = total
                course['completedLessons'] = completed
                course['progress'] = round((completed / total) * 100) if total > 0 else 0
                course['status'] = 'completed' if course['progress'] == 100 else ('in-progress' if course['progress'] > 0 else 'not-started')
            write_db(db)
            self.send_json(course)
        elif path.startswith('/api/courses/') and path.endswith('/progress'):
            course_id = path.split('/')[-2]
            db = read_db()
            course = next((c for c in db['courses'] if c['id'] == course_id), None)
            if not course:
                self.send_json({'error': 'Course not found'}, 404)
                return
            completed = body.get('completedLessons')
            if not isinstance(completed, int):
                self.send_json({'error': 'completedLessons required'}, 400)
                return
            course['completedLessons'] = min(completed, course['totalLessons'])
            course['progress'] = round((course['completedLessons'] / course['totalLessons']) * 100) if course['totalLessons'] > 0 else 0
            if course['progress'] == 100:
                course['status'] = 'completed'
            elif course['progress'] > 0:
                course['status'] = 'in-progress'
            else:
                course['status'] = 'not-started'
            write_db(db)
            self.send_json(course)
        elif path.startswith('/api/courses/') and '/lessons/' in path:
            parts = path.strip('/').split('/')
            course_id = parts[2]
            lesson_id = parts[4]
            db = read_db()
            course = next((c for c in db['courses'] if c['id'] == course_id), None)
            if not course:
                self.send_json({'error': 'Course not found'}, 404)
                return
            lesson = next((l for l in course.get('lessons', []) if l['id'] == lesson_id), None)
            if not lesson:
                self.send_json({'error': 'Lesson not found'}, 404)
                return
            if 'completed' in body:
                lesson['completed'] = bool(body['completed'])
            if 'title' in body:
                lesson['title'] = body['title']
            if 'body' in body:
                lesson['body'] = body['body']
            total = len(course['lessons'])
            completed = len([l for l in course['lessons'] if l.get('completed')])
            course['totalLessons'] = total
            course['completedLessons'] = completed
            course['progress'] = round((completed / total) * 100) if total > 0 else 0
            if course['progress'] == 100:
                course['status'] = 'completed'
            elif course['progress'] > 0:
                course['status'] = 'in-progress'
            else:
                course['status'] = 'not-started'
            write_db(db)
            self.send_json(course)
        elif path.startswith('/api/accounts/') and path.count('/') == 3:
            account_id = path.split('/')[-1]
            db = read_db()
            account = next((a for a in db['accounts'] if a['id'] == account_id), None)
            if not account:
                self.send_json({'error': 'Account not found'}, 404)
                return
            user = get_session_user(db, self.headers.get('Cookie'))
            if not user or user['id'] != account_id:
                self.send_json({'error': 'Not authorized'}, 403)
                return
            for field in ('avatarUrl', 'avatar', 'displayName', 'bio'):
                if field in body:
                    account[field] = body[field]
            write_db(db)
            self.send_json(safe_account(account))
        else:
            self.send_json({'error': 'Not found'}, 404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith('/api/courses/') and path.count('/') == 3:
            course_id = path.split('/')[-1]
            db = read_db()
            db['courses'] = [c for c in db['courses'] if c['id'] != course_id]
            write_db(db)
            self.send_json({'ok': True})
        else:
            self.send_json({'error': 'Not found'}, 404)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, format, *args):
        pass

if __name__ == '__main__':
    os.chdir(os.path.dirname(__file__))
    server = HTTPServer(('', PORT), APIHandler)
    print(f"Skill Loop API server running on http://localhost:{PORT}")
    server.serve_forever()
