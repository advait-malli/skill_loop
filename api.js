const API_BASE = '/api';

async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const config = {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options
  };
  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }
  const response = await fetch(url, config);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || 'Request failed');
  }
  return response.json();
}

export const api = {
  accounts: {
    getAll: () => request('/accounts'),
    get: (id) => request(`/accounts/${id}`),
    getPosts: (id) => request(`/accounts/${id}/posts`),
    getCurrent: () => request('/auth/me')
  },
  posts: {
    getAll: (params = {}) => {
      const query = new URLSearchParams(params).toString();
      return request(`/posts${query ? `?${query}` : ''}`);
    },
    get: (id) => request(`/posts/${id}`),
    create: (data) => request('/posts', { method: 'POST', body: data }),
    like: (id, userId) => request(`/posts/${id}/like`, { method: 'POST', body: { userId } }),
    addComment: (id, data) => request(`/posts/${id}/comments`, { method: 'POST', body: data })
  },
  courses: {
    getAll: (params = {}) => {
      const query = new URLSearchParams(params).toString();
      return request(`/courses${query ? `?${query}` : ''}`);
    },
    get: (id) => request(`/courses/${id}`),
    create: (data) => request('/courses', { method: 'POST', body: data }),
    update: (id, data) => request(`/courses/${id}`, { method: 'PATCH', body: data }),
    updateLesson: (courseId, lessonId, data) => request(`/courses/${courseId}/lessons/${lessonId}`, { method: 'PATCH', body: data }),
    updateProgress: (id, completedLessons) => request(`/courses/${id}/progress`, { method: 'PATCH', body: { completedLessons } }),
    delete: (id) => request(`/courses/${id}`, { method: 'DELETE' })
  },
  upload: {
    file: (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const meta = await request('/upload', {
            method: 'POST',
            body: { name: file.name, data: reader.result }
          });
          resolve(meta);
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    })
  }
};

export function formatTimeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

export function createAvatar(letter, size = 'md') {
  const sizes = { sm: 32, md: 36, lg: 40, xl: 48 };
  const fontSizes = { sm: '0.75rem', md: '0.9rem', lg: '0.9rem', xl: '0.9rem' };
  const div = document.createElement('div');
  div.className = `avatar avatar-${size}`;
  div.style.width = `${sizes[size]}px`;
  div.style.height = `${sizes[size]}px`;
  div.style.fontSize = fontSizes[size];
  div.textContent = letter;
  return div;
}

export function renderPostCard(post, currentUserId) {
  const author = post.author || {};
  const timeAgo = formatTimeAgo(post.createdAt);
  const tagsHtml = post.tags?.map(t => `<span class="material-symbols-outlined inline-icon">${t}</span>`).join(' ') || '';
  const title = post.title || 'Shared a resource';
  const cover = post.image || `https://placehold.co/640x360/1e293b/00EBA9?text=${encodeURIComponent(title)}`;
  const card = document.createElement('div');
  card.className = 'post-card course-post-card';
  card.innerHTML = `
    <div class="course-image post-card-cover" data-post-id="${post.id}" data-action="open">
      <img src="${cover}" alt="${post.title || ''}">
    </div>
    <div class="course-details">
      <div class="details">
        <h3 data-post-id="${post.id}" data-action="open">${title} ${tagsHtml}</h3>
        <p class="instructor">
          ${author.avatarUrl
            ? `<img class="avatar-sm" src="${author.avatarUrl}" alt="">`
            : `<span class="avatar-sm">${author.avatar || '?'}</span>`}
          ${author.displayName || 'Unknown'} · ${timeAgo}
        </p>
      </div>
    </div>
    <div class="post-attachments" style="display: none;">
      <h4>Attached Files</h4>
      <div class="file-list">
        ${post.files?.map(f => f.path
          ? `<a href="${f.path}" download="${f.name}" style="text-decoration:none" class="file-item"><span class="material-symbols-outlined inline-icon">${f.icon || 'insert_drive_file'}</span> ${f.name}</a>`
          : `<div class="file-item"><span class="material-symbols-outlined inline-icon">${f.icon || 'insert_drive_file'}</span> ${f.name}</div>`).join('') || ''}
      </div>
    </div>
    <div class="post-comments" style="display: none;"></div>
  `;
  return card;
}

export function renderCourseCard(course) {
  const card = document.createElement('a');
  card.className = 'course-card';
  card.href = `course.html?id=${course.id}`;
  card.innerHTML = `
    <div class="course-image"><img src="${course.image}" width="100%" alt="${course.title}"></div>
    <div class="course-details">
      <div class="details">
        <h3>${course.title}</h3>
        <p class="instructor">With ${course.instructor}</p>
      </div>
      <div class="course-meta">
        <span>${course.completedLessons || 0} of ${course.totalLessons || 0} lessons</span>
        <span>${course.progress || 0}% completed</span>
      </div>
    </div>
    <div class="progress-section">
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${course.progress || 0}%"></div>
      </div>
    </div>
  `;
  return card;
}

export function renderAccountCard(account, type) {
  const card = document.createElement('div');
  card.className = 'card';
  const meta = {
    'skills-offered': `${account.skillsOffered?.length || 0} skills available for swap`,
    'skills-wanted': `${account.skillsWanted?.length || 0} active swap requests`,
    swaps: '5 active skill exchanges',
    reviews: '12 reviews from skill swaps'
  };
  const titles = {
    'skills-offered': 'Skills I Offer',
    'skills-wanted': 'Skills I Want to Learn',
    swaps: 'My Swaps',
    reviews: 'Reviews'
  };
  card.innerHTML = `
    <h2>${titles[type] || type}</h2>
    <p>${(account[`skills${type === 'skills-offered' ? 'Offered' : 'Wanted'}`] || []).join(', ')}</p>
    <p class="meta">${meta[type] || ''}</p>
  `;
  return card;
}
