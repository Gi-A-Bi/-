// =================================================================
// 우리반 모험단 - SPA 프론트엔드
// =================================================================

const state = {
  classId: 1, // 현재는 단일 학급. 추후 멀티 학급 확장.
  className: '우리반 모험단',
  view: 'list', // list | detail | logs | settings
  currentStudentId: null,
  students: [],
  levelTable: [],
  activities: [], // 점수 부여 활동 목록 (DB)
  settingsTab: 'activities', // 'activities' | 'skills'
}

// ==============================
// API 헬퍼
// ==============================
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

// ==============================
// 유틸리티
// ==============================
function getInitial(name) {
  if (!name) return '?'
  return name.trim().charAt(0)
}

function rankInfo(rank) {
  if (rank === 'gold') return { label: '골드', icon: '🥇', cls: 'rank-gold' }
  if (rank === 'silver') return { label: '실버', icon: '🥈', cls: 'rank-silver' }
  return { label: '브론즈', icon: '🥉', cls: 'rank-bronze' }
}

function escapeHtml(str) {
  if (str == null) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function formatTime(iso) {
  if (!iso) return ''
  // SQLite returns "YYYY-MM-DD HH:MM:SS" in UTC. Parse it safely.
  let d
  if (iso.includes('T')) {
    d = new Date(iso)
  } else {
    d = new Date(iso.replace(' ', 'T') + 'Z')
  }
  if (isNaN(d.getTime())) return iso
  const now = new Date()
  const diffMs = now - d
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return '방금 전'
  if (diffMin < 60) return `${diffMin}분 전`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}시간 전`
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}/${dd} ${hh}:${mi}`
}

function activityEmoji(name) {
  if (name.includes('숙제')) return '📝'
  if (name.includes('출석')) return '✅'
  if (name.includes('아침 독서') || name.includes('독서')) return '📚'
  if (name.includes('친구 돕기') || name.includes('돕기')) return '🤝'
  if (name.includes('폭풍 칭찬') || name.includes('칭찬')) return '🌟'
  if (name.includes('벌점')) return '⚠️'
  if (name.includes('레벨') && name.includes('달성')) return '🎉'
  if (name.includes('스킬 사용')) return '✨'
  if (name.includes('선택')) return '🎁'
  return '📌'
}

function skillEmoji(name) {
  if (!name) return '✨'
  if (name.includes('스티커') || name.includes('도장')) return '🌟'
  if (name.includes('간식') || name.includes('급식')) return '🍪'
  if (name.includes('자유석') || name.includes('자리')) return '💺'
  if (name.includes('코믹') || name.includes('책') || name.includes('도서')) return '📖'
  if (name.includes('음악')) return '🎵'
  if (name.includes('체육')) return '⚽'
  if (name.includes('숙제')) return '📝'
  if (name.includes('청소')) return '🧹'
  if (name.includes('보드게임')) return '🎲'
  if (name.includes('칭찬')) return '🏆'
  return '🎁'
}

function passiveEmoji(name) {
  if (!name) return '🛡️'
  if (name.includes('리더')) return '👑'
  if (name.includes('발표')) return '🎤'
  if (name.includes('인사')) return '👋'
  if (name.includes('모험가') || name.includes('초보')) return '🗡️'
  if (name.includes('마스터') || name.includes('전설')) return '🏅'
  if (name.includes('모둠') || name.includes('멘토')) return '🧑‍🏫'
  if (name.includes('도서') || name.includes('우대')) return '📚'
  if (name.includes('청소')) return '🧹'
  return '🛡️'
}

// ==============================
// 토스트
// ==============================
function showToast(text, type = 'success', emoji = null) {
  const container = document.getElementById('toast-container')
  const toast = document.createElement('div')
  toast.className = `toast ${type}`
  const defaultEmoji = type === 'success' ? '✅' : type === 'warning' ? '⚠️' : type === 'error' ? '❌' : type === 'level-up' ? '🎉' : '💬'
  toast.innerHTML = `<span class="toast-emoji">${emoji || defaultEmoji}</span><span class="toast-text">${escapeHtml(text)}</span>`
  container.appendChild(toast)
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s, transform 0.3s'
    toast.style.opacity = '0'
    toast.style.transform = 'translateY(-10px)'
    setTimeout(() => toast.remove(), 300)
  }, 2400)
}

// ==============================
// 모달
// ==============================
function showConfirm(title, message, onConfirm) {
  const container = document.getElementById('modal-container')
  container.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-title">${escapeHtml(title)}</div>
        <div style="text-align:center; color:var(--text-light); font-size:14px;">${escapeHtml(message)}</div>
        <div class="modal-actions">
          <button class="btn-cancel" id="modal-cancel">취소</button>
          <button class="btn-confirm" id="modal-confirm">확인</button>
        </div>
      </div>
    </div>
  `
  document.getElementById('modal-cancel').onclick = () => container.innerHTML = ''
  document.getElementById('modal-confirm').onclick = () => {
    container.innerHTML = ''
    onConfirm()
  }
}

// 특별 점수 부여: 점수 + 사유 직접 입력
function showCustomScorePrompt(studentId, baseName) {
  const container = document.getElementById('modal-container')
  container.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-title">✨ 특별 점수 부여</div>
        <div style="display:flex; flex-direction:column; gap:10px; margin-top:8px;">
          <div>
            <label style="font-size:12px; color:var(--text-light); font-weight:bold;">사유 (활동명)</label>
            <input type="text" id="custom-name" placeholder="예: 학급 회의 사회"
              style="width:100%; padding:10px; border:2px solid #e5e7eb; border-radius:10px; font-family:inherit; font-size:14px; margin-top:4px;" />
          </div>
          <div>
            <label style="font-size:12px; color:var(--text-light); font-weight:bold;">점수 (음수면 차감)</label>
            <input type="number" id="custom-delta" placeholder="예: 15 또는 -5" value="10"
              style="width:100%; padding:10px; border:2px solid #e5e7eb; border-radius:10px; font-family:inherit; font-size:14px; margin-top:4px;" />
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn-cancel" id="modal-cancel">취소</button>
          <button class="btn-confirm" id="modal-confirm">부여하기</button>
        </div>
      </div>
    </div>
  `
  const nameInput = document.getElementById('custom-name')
  const deltaInput = document.getElementById('custom-delta')
  setTimeout(() => nameInput.focus(), 50)

  document.getElementById('modal-cancel').onclick = () => container.innerHTML = ''
  document.getElementById('modal-confirm').onclick = () => {
    const name = nameInput.value.trim() || '특별 점수'
    const delta = Number(deltaInput.value) || 0
    if (delta === 0) {
      showToast('점수를 입력해주세요', 'warning')
      return
    }
    container.innerHTML = ''
    addScore(studentId, name, delta)
  }
}

// ==============================
// 헤더 갱신
// ==============================
function updateHeader() {
  const titleEl = document.getElementById('header-title')
  const titleText = document.getElementById('header-title-text')
  if (state.view === 'list') {
    titleText.innerHTML = '우리반 모험단'
    titleEl.onclick = null
  } else {
    let label = ''
    if (state.view === 'detail') label = '캐릭터 시트'
    else if (state.view === 'logs') label = '활동 기록'
    else if (state.view === 'settings') label = '설정 - 레벨표'
    titleText.innerHTML = `<span class="back-arrow">←</span>${label}`
    titleEl.onclick = () => navigate('list')
  }
}

// ==============================
// 라우팅
// ==============================
async function navigate(view, params = {}) {
  state.view = view
  if (view === 'detail') state.currentStudentId = params.studentId
  updateHeader()
  const main = document.getElementById('main-view')
  main.innerHTML = '<div class="view-container hint-text">불러오는 중...</div>'

  try {
    if (view === 'list') await renderList()
    else if (view === 'detail') await renderDetail(state.currentStudentId)
    else if (view === 'logs') await renderLogs()
    else if (view === 'settings') await renderSettings()
  } catch (e) {
    main.innerHTML = `<div class="view-container hint-text">오류: ${escapeHtml(e.message)}</div>`
  }

  window.scrollTo(0, 0)
}

// ==============================
// 화면 1: 학생 목록
// ==============================
async function renderList() {
  const students = await api(`/api/classes/${state.classId}/students`)
  state.students = students

  const main = document.getElementById('main-view')

  if (students.length === 0) {
    main.innerHTML = `
      <div class="view-container">
        <div class="empty-state">아직 학생이 없습니다.</div>
      </div>
    `
    return
  }

  const cards = students.map(s => {
    const rank = rankInfo(s.rank)
    const pending = s.pending_choice_count > 0
    return `
      <div class="student-card ${pending ? 'has-pending' : ''}" data-id="${s.id}">
        ${pending ? `<div class="pending-badge">선택!</div>` : ''}
        <div class="avatar" style="background: linear-gradient(135deg, ${s.avatar_color}, ${s.avatar_color}cc);">
          ${escapeHtml(getInitial(s.name))}
        </div>
        <div class="student-name">${escapeHtml(s.name)}</div>
        <div class="level-row">
          <span class="level-pill">Lv.${s.level}</span>
          <span class="rank-badge ${rank.cls}">${rank.icon} ${rank.label}</span>
        </div>
        <div class="skill-count">
          <i class="fa-solid fa-gift"></i> 보유 스킬 ${s.skill_count}개
        </div>
      </div>
    `
  }).join('')

  main.innerHTML = `
    <div class="view-container">
      <div class="view-title">
        <span>🏰</span> 우리 반 친구들
        <span style="margin-left:auto; font-size:14px; color:var(--text-light); font-weight:normal;">${students.length}명</span>
      </div>
      <div class="student-grid">${cards}</div>
    </div>
  `

  main.querySelectorAll('.student-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = Number(card.dataset.id)
      navigate('detail', { studentId: id })
    })
  })
}

// ==============================
// 화면 2: 학생 상세
// ==============================
async function renderDetail(id) {
  // 학생 데이터와 활동 목록을 병렬로 로드 (활동은 캐시)
  const [s, activities] = await Promise.all([
    api(`/api/students/${id}`),
    state.activities.length ? Promise.resolve(state.activities) : api(`/api/classes/${state.classId}/activities`),
  ])
  state.activities = activities
  const rank = rankInfo(s.rank)

  // XP 진행률 계산
  const cur = s.current_required_xp
  const nxt = s.next_required_xp
  let pct = 100
  let xpToNext = 0
  if (nxt != null) {
    const range = nxt - cur
    const into = s.xp - cur
    pct = range > 0 ? Math.max(0, Math.min(100, (into / range) * 100)) : 0
    xpToNext = nxt - s.xp
  }

  // HP 하트
  const hearts = []
  for (let i = 0; i < s.max_hp; i++) {
    const full = i < s.hp
    hearts.push(`<span class="heart ${full ? 'full' : 'empty'}">${full ? '❤️' : '🩶'}</span>`)
  }

  // 점수 버튼 (DB의 activities에서 로드)
  const scoreBtns = activities.map(a => {
    if (a.is_custom_input) {
      // 특별 점수 부여: 교사가 직접 점수 입력
      return `
        <button class="score-btn custom" data-activity-id="${a.id}" data-custom="1" data-name="${escapeHtml(a.name)}">
          <div class="emoji">${a.emoji || '✨'}</div>
          <div class="label">${escapeHtml(a.name)}</div>
          <div class="delta" style="background:#ede9fe;color:#6d28d9;">직접 입력</div>
        </button>
      `
    }
    const type = a.score_delta >= 0 ? 'positive' : 'negative'
    return `
      <button class="score-btn ${type}" data-activity-id="${a.id}" data-name="${escapeHtml(a.name)}" data-delta="${a.score_delta}">
        <div class="emoji">${a.emoji || '⭐'}</div>
        <div class="label">${escapeHtml(a.name)}</div>
        <div class="delta ${a.score_delta >= 0 ? 'delta-pos' : 'delta-neg'}">${a.score_delta >= 0 ? '+' : ''}${a.score_delta} XP</div>
      </button>
    `
  }).join('')

  // 선택 대기
  const choices = s.pending_choices.map(pc => `
    <div class="choice-card">
      <div class="choice-title">🎁 Lv.${pc.level} 보상 선택</div>
      <div class="choice-sub">${escapeHtml(pc.reward_desc || '아래 두 보상 중 하나를 골라주세요')}</div>
      <div class="choice-options">
        <button class="choice-option" data-choice-id="${pc.id}" data-pick="A">
          <span class="opt-label">A</span>
          ${escapeHtml(pc.choice_a)}
        </button>
        <button class="choice-option" data-choice-id="${pc.id}" data-pick="B">
          <span class="opt-label">B</span>
          ${escapeHtml(pc.choice_b)}
        </button>
      </div>
    </div>
  `).join('')

  // 보유 스킬
  const skills = s.skills.map(sk => `
    <div class="skill-card">
      <div class="skill-icon">${skillEmoji(sk.skill_name)}</div>
      <div class="skill-info">
        <div class="skill-name">${escapeHtml(sk.skill_name)}</div>
        <div class="skill-source">Lv.${sk.source_level} 보상</div>
      </div>
      <button class="use-btn" data-skill-id="${sk.id}" data-skill-name="${escapeHtml(sk.skill_name)}">사용하기</button>
    </div>
  `).join('')

  const passiveSkill = s.passive_skill || '없음'

  const main = document.getElementById('main-view')
  main.innerHTML = `
    <div class="view-container">
      <!-- 캐릭터 헤로 -->
      <div class="detail-hero">
        <div class="avatar avatar-lg" style="background: linear-gradient(135deg, ${s.avatar_color}, ${s.avatar_color}cc);">
          ${escapeHtml(getInitial(s.name))}
        </div>
        <div class="detail-name">${escapeHtml(s.name)}</div>
        <div class="detail-badges">
          <span class="level-pill" style="font-size:14px; padding:4px 12px;">Lv.${s.level}</span>
          <span class="rank-badge ${rank.cls}" style="font-size:14px; padding:4px 12px;">${rank.icon} ${rank.label}</span>
        </div>

        <div class="hp-row">
          <span class="hp-label">HP</span>
          <div class="hp-hearts">${hearts.join('')}</div>
          <div class="hp-controls">
            <button id="hp-minus">−</button>
            <button id="hp-plus">+</button>
          </div>
        </div>

        <div class="xp-section">
          <div class="xp-info">
            <span class="xp-current">XP ${s.xp}</span>
            <span>${nxt != null ? `다음 레벨까지 ${xpToNext} XP` : '🌟 최고 레벨'}</span>
          </div>
          <div class="xp-bar-bg">
            <div class="xp-bar-fg" style="width: ${pct}%;"></div>
          </div>
        </div>
      </div>

      ${choices}

      <!-- 점수 주기 -->
      <div class="section-card">
        <div class="section-title"><span>⚡</span> 점수 주기</div>
        <div class="score-grid">${scoreBtns}</div>
      </div>

      <!-- 패시브 스킬 -->
      <div class="section-card">
        <div class="section-title"><span>🛡️</span> 패시브 스킬 (상시)</div>
        <div class="passive-card">
          <div class="passive-icon">${passiveEmoji(passiveSkill)}</div>
          <div class="passive-info">
            <div class="passive-label">현재 레벨 ${s.level} 패시브</div>
            <div class="passive-name">${escapeHtml(passiveSkill)}</div>
          </div>
        </div>
      </div>

      <!-- 보유 스킬 (해금) -->
      <div class="section-card">
        <div class="section-title">
          <span>🎁</span> 보유 스킬 (해금·소모)
          <span class="count-pill">${s.skills.length}</span>
        </div>
        ${s.skills.length === 0
          ? `<div class="empty-state">아직 보유한 스킬이 없어요.<br/>레벨을 올리면 스킬이 쌓여요!</div>`
          : `<div class="skill-list">${skills}</div>`}
      </div>
    </div>
  `

  // 이벤트 바인딩
  main.querySelectorAll('.score-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.custom === '1') {
        showCustomScorePrompt(id, btn.dataset.name)
      } else {
        addScore(id, btn.dataset.name, Number(btn.dataset.delta))
      }
    })
  })

  document.getElementById('hp-minus').onclick = () => adjustHp(id, -1)
  document.getElementById('hp-plus').onclick = () => adjustHp(id, +1)

  main.querySelectorAll('.use-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const skillId = Number(btn.dataset.skillId)
      const name = btn.dataset.skillName
      showConfirm(
        `${name} 사용`,
        '이 스킬은 한 번 사용하면 사라집니다. 사용할까요?',
        () => useSkill(id, skillId, name)
      )
    })
  })

  main.querySelectorAll('.choice-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const choiceId = Number(btn.dataset.choiceId)
      const pick = btn.dataset.pick
      resolveChoice(id, choiceId, pick)
    })
  })
}

async function addScore(studentId, name, delta) {
  try {
    const res = await api(`/api/students/${studentId}/score`, {
      method: 'POST',
      body: JSON.stringify({ activity_name: name, score_delta: delta }),
    })
    showToast(`${name} ${delta >= 0 ? '+' : ''}${delta} XP`, delta >= 0 ? 'success' : 'warning', activityEmoji(name))

    if (res.leveled_up) {
      setTimeout(() => {
        showToast(`🎉 레벨 ${res.new_level} 달성!`, 'level-up', '🎉')
      }, 300)
      if (res.new_skills && res.new_skills.length > 0) {
        res.new_skills.forEach((skillName, i) => {
          setTimeout(() => {
            showToast(`새 스킬: ${skillName}`, 'level-up', '🎁')
          }, 600 + i * 400)
        })
      }
      if (res.new_pending_choices && res.new_pending_choices.length > 0) {
        res.new_pending_choices.forEach((pc, i) => {
          setTimeout(() => {
            showToast(`Lv.${pc.level} 보상을 선택하세요!`, 'level-up', '✨')
          }, 600 + (res.new_skills?.length || 0) * 400 + i * 400)
        })
      }
    }

    await renderDetail(studentId)
  } catch (e) {
    showToast(e.message, 'error')
  }
}

async function adjustHp(studentId, delta) {
  try {
    await api(`/api/students/${studentId}/hp`, {
      method: 'POST',
      body: JSON.stringify({ delta }),
    })
    await renderDetail(studentId)
  } catch (e) {
    showToast(e.message, 'error')
  }
}

async function useSkill(studentId, skillId, name) {
  try {
    await api(`/api/students/${studentId}/skills/${skillId}/use`, { method: 'POST' })
    showToast(`${name} 스킬을 사용했어요!`, 'success', '✨')
    await renderDetail(studentId)
  } catch (e) {
    showToast(e.message, 'error')
  }
}

async function resolveChoice(studentId, choiceId, pick) {
  try {
    const res = await api(`/api/students/${studentId}/choices/${choiceId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ pick }),
    })
    showToast(`보상 획득: ${res.picked}`, 'level-up', '🎁')
    await renderDetail(studentId)
  } catch (e) {
    showToast(e.message, 'error')
  }
}

// ==============================
// 화면 3: 활동 기록
// ==============================
async function renderLogs() {
  const logs = await api(`/api/classes/${state.classId}/logs?limit=300`)

  const main = document.getElementById('main-view')

  if (logs.length === 0) {
    main.innerHTML = `
      <div class="view-container">
        <div class="view-title"><span>📜</span> 활동 기록</div>
        <div class="empty-state">아직 활동이 없어요.</div>
      </div>
    `
    return
  }

  const items = logs.map(l => {
    let deltaHtml = ''
    if (l.log_type === 'score' && l.score_delta !== 0) {
      const cls = l.score_delta > 0 ? 'delta-pos' : 'delta-neg'
      deltaHtml = `<span class="log-delta ${cls}">${l.score_delta > 0 ? '+' : ''}${l.score_delta} XP</span>`
    } else if (l.log_type === 'level_up') {
      deltaHtml = `<span class="log-delta delta-pos">레벨업!</span>`
    } else if (l.log_type === 'skill_use') {
      deltaHtml = `<span class="log-delta" style="background:#fef3c7;color:#92400e;">사용</span>`
    } else if (l.log_type === 'skill_choice') {
      deltaHtml = `<span class="log-delta" style="background:#ede9fe;color:#6d28d9;">선택</span>`
    }

    return `
      <div class="log-item">
        <div class="log-avatar" style="background: linear-gradient(135deg, ${l.avatar_color}, ${l.avatar_color}cc);">
          ${escapeHtml(getInitial(l.student_name))}
        </div>
        <div class="log-content">
          <div class="log-line1">
            <span class="log-type-icon">${activityEmoji(l.activity_name)}</span>
            <span class="log-name">${escapeHtml(l.student_name)}</span>
            <span class="log-activity">${escapeHtml(l.activity_name)}</span>
          </div>
          <div class="log-time">${formatTime(l.created_at)}</div>
        </div>
        ${deltaHtml}
      </div>
    `
  }).join('')

  main.innerHTML = `
    <div class="view-container">
      <div class="view-title">
        <span>📜</span> 활동 기록
        <span style="margin-left:auto; font-size:14px; color:var(--text-light); font-weight:normal;">${logs.length}건</span>
      </div>
      <div class="log-list">${items}</div>
    </div>
  `
}

// ==============================
// 화면 4: 설정 (활동 점수 / 스킬 내용만 편집)
// 게임 뼈대(레벨별 기준 XP, 등급 구간, HP 규칙)는 고정.
// ==============================
async function renderSettings() {
  const main = document.getElementById('main-view')

  main.innerHTML = `
    <div class="view-container">
      <div class="view-title"><span>⚙️</span> 교사 설정</div>

      <div class="settings-tabs">
        <button class="settings-tab ${state.settingsTab === 'activities' ? 'active' : ''}" data-tab="activities">
          ⚡ 활동 점수
        </button>
        <button class="settings-tab ${state.settingsTab === 'skills' ? 'active' : ''}" data-tab="skills">
          🎁 스킬 내용
        </button>
      </div>

      <div class="hint-text" style="background:#ede9fe;border-radius:12px;margin-bottom:10px;padding:10px;color:#5b21b6;text-align:left;line-height:1.5;">
        💡 게임 뼈대(레벨별 기준 XP, 등급 구간, HP 규칙)는 고정입니다.<br/>
        설정에서 수정 가능한 것은 ① 활동별 점수와 ② 스킬 이름·보상 설명 두 가지입니다.
      </div>

      <div id="settings-body"></div>
    </div>
  `

  // 탭 전환
  main.querySelectorAll('.settings-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.settingsTab = btn.dataset.tab
      renderSettings()
    })
  })

  if (state.settingsTab === 'activities') {
    await renderActivitiesSettings()
  } else {
    await renderSkillsSettings()
  }
}

// ----- 활동 점수 편집 -----
async function renderActivitiesSettings() {
  const body = document.getElementById('settings-body')
  body.innerHTML = '<div class="hint-text">불러오는 중...</div>'

  const activities = await api(`/api/classes/${state.classId}/activities`)
  state.activities = activities

  const rows = activities.map(a => `
    <div class="activity-edit-item ${a.is_custom_input ? 'custom' : ''}" data-id="${a.id}">
      <input type="text" class="f-emoji" value="${escapeHtml(a.emoji || '⭐')}" maxlength="3" />
      <input type="text" class="f-name" value="${escapeHtml(a.name)}" placeholder="활동명" />
      ${a.is_custom_input
        ? `<div class="custom-badge">직접 입력</div>`
        : `<input type="number" class="f-delta" value="${a.score_delta}" placeholder="점수" />`
      }
      ${a.is_custom_input
        ? `<button class="btn-mini" disabled style="opacity:0.4;cursor:not-allowed;">🗑</button>`
        : `<button class="btn-mini danger delete-act-btn">🗑</button>`
      }
    </div>
  `).join('')

  body.innerHTML = `
    <div class="activity-edit-list">${rows}</div>
    <button class="btn-add-level" id="add-activity">＋ 새 활동 추가</button>
    <div class="hint-text" style="margin-top:8px;">
      입력 후 다른 곳을 누르면 자동 저장됩니다. (점수는 음수도 가능)
    </div>
  `

  // 자동 저장 (blur 시)
  body.querySelectorAll('.activity-edit-item').forEach(item => {
    const id = Number(item.dataset.id)
    const inputs = item.querySelectorAll('input')
    inputs.forEach(inp => {
      inp.addEventListener('blur', async () => {
        const name = item.querySelector('.f-name').value.trim()
        const emoji = item.querySelector('.f-emoji').value.trim() || '⭐'
        const deltaEl = item.querySelector('.f-delta')
        const body = { name, emoji }
        if (deltaEl) body.score_delta = Number(deltaEl.value) || 0
        if (!name) {
          showToast('활동명을 입력해주세요', 'warning')
          return
        }
        try {
          await api(`/api/activities/${id}`, {
            method: 'PUT',
            body: JSON.stringify(body),
          })
          state.activities = [] // 캐시 무효화
          // 잔잔한 저장 피드백
          item.style.transition = 'background 0.3s'
          item.style.background = '#dcfce7'
          setTimeout(() => item.style.background = '', 600)
        } catch (e) {
          showToast(e.message, 'error')
        }
      })
    })
  })

  // 삭제
  body.querySelectorAll('.delete-act-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.activity-edit-item')
      const id = Number(item.dataset.id)
      const name = item.querySelector('.f-name').value
      showConfirm(`'${name}' 활동 삭제`, '이 활동 버튼을 삭제할까요?', async () => {
        try {
          await api(`/api/activities/${id}`, { method: 'DELETE' })
          state.activities = []
          showToast('삭제됨', 'success', '🗑')
          await renderActivitiesSettings()
        } catch (e) {
          showToast(e.message, 'error')
        }
      })
    })
  })

  // 추가
  document.getElementById('add-activity').onclick = async () => {
    try {
      await api(`/api/classes/${state.classId}/activities`, {
        method: 'POST',
        body: JSON.stringify({
          name: '새 활동',
          score_delta: 10,
          emoji: '⭐',
        }),
      })
      state.activities = []
      showToast('활동 추가됨', 'success', '➕')
      await renderActivitiesSettings()
    } catch (e) {
      showToast(e.message, 'error')
    }
  }
}

// ----- 스킬 내용 편집 -----
// 레벨/XP/등급/선택형 여부 구조는 고정. 스킬 이름·보상 설명·선택지 텍스트만 수정 가능.
async function renderSkillsSettings() {
  const body = document.getElementById('settings-body')
  body.innerHTML = '<div class="hint-text">불러오는 중...</div>'

  const levels = await api(`/api/classes/${state.classId}/level-table`)
  state.levelTable = levels

  // 해금 스킬이 있거나 선택형인 레벨만 편집 대상으로 표시
  const editableLevels = levels.filter(lv => lv.unlock_skill || lv.is_choice)

  const rows = editableLevels.map(lv => {
    const rank = lv.rank
    const rankBadge = rank === 'gold' ? '🥇' : rank === 'silver' ? '🥈' : '🥉'

    if (lv.is_choice) {
      return `
        <div class="skill-edit-item choice" data-level="${lv.level}">
          <div class="skill-edit-head">
            <span class="level-pill">Lv.${lv.level}</span>
            <span class="rank-badge rank-${rank}">${rankBadge} ${rank === 'gold' ? '골드' : rank === 'silver' ? '실버' : '브론즈'}</span>
            <span class="choice-tag">A/B 선택형</span>
          </div>
          <div class="skill-edit-row">
            <label>선택 A</label>
            <input type="text" class="f-choice-a" value="${escapeHtml(lv.choice_a || '')}" placeholder="예: 숙제 반값 할인권" />
          </div>
          <div class="skill-edit-row">
            <label>선택 B</label>
            <input type="text" class="f-choice-b" value="${escapeHtml(lv.choice_b || '')}" placeholder="예: 1일 자유석 이용권" />
          </div>
          <div class="skill-edit-row">
            <label>보상 설명</label>
            <input type="text" class="f-desc" value="${escapeHtml(lv.reward_desc || '')}" placeholder="둘 중 하나를 직접 선택" />
          </div>
        </div>
      `
    } else {
      return `
        <div class="skill-edit-item" data-level="${lv.level}">
          <div class="skill-edit-head">
            <span class="level-pill">Lv.${lv.level}</span>
            <span class="rank-badge rank-${rank}">${rankBadge} ${rank === 'gold' ? '골드' : rank === 'silver' ? '실버' : '브론즈'}</span>
            <span class="unlock-tag">자동 해금</span>
          </div>
          <div class="skill-edit-row">
            <label>스킬명</label>
            <input type="text" class="f-name" value="${escapeHtml(lv.unlock_skill || '')}" placeholder="예: 미니펫" />
          </div>
          <div class="skill-edit-row">
            <label>보상 설명</label>
            <input type="text" class="f-desc" value="${escapeHtml(lv.reward_desc || '')}" placeholder="예: 책상에 인형 1개 전시 허용" />
          </div>
        </div>
      `
    }
  }).join('')

  body.innerHTML = `
    <div class="hint-text" style="background:#fef3c7;border-radius:12px;margin-bottom:10px;padding:10px;color:#92400e;text-align:left;line-height:1.5;">
      🔒 <b>구조 고정</b>: 몇 레벨에 스킬이 해금되는지는 바꿀 수 없습니다.<br/>
      ✏️ <b>편집 가능</b>: 그 자리의 스킬 이름과 보상 설명만 자유롭게 수정·변경 가능합니다.
    </div>
    <div class="skill-edit-list">${rows}</div>
    <div class="hint-text" style="margin-top:8px;">
      입력 후 다른 곳을 누르면 자동 저장됩니다.
    </div>
  `

  // 자동 저장
  body.querySelectorAll('.skill-edit-item').forEach(item => {
    const level = Number(item.dataset.level)
    const isChoice = item.classList.contains('choice')
    const inputs = item.querySelectorAll('input')
    inputs.forEach(inp => {
      inp.addEventListener('blur', async () => {
        const reward_desc = item.querySelector('.f-desc').value.trim()
        const body = { reward_desc }
        if (isChoice) {
          body.choice_a = item.querySelector('.f-choice-a').value.trim()
          body.choice_b = item.querySelector('.f-choice-b').value.trim()
        } else {
          const name = item.querySelector('.f-name').value.trim()
          if (!name) {
            showToast('스킬명을 입력해주세요', 'warning')
            return
          }
          body.unlock_skill = name
        }
        try {
          await api(`/api/classes/${state.classId}/level-table/${level}/skill`, {
            method: 'PUT',
            body: JSON.stringify(body),
          })
          item.style.transition = 'background 0.3s'
          item.style.background = '#dcfce7'
          setTimeout(() => item.style.background = '', 600)
        } catch (e) {
          showToast(e.message, 'error')
        }
      })
    })
  })
}

// ==============================
// 헤더 버튼
// ==============================
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('nav-logs').onclick = () => navigate('logs')
  document.getElementById('nav-settings').onclick = () => navigate('settings')
  document.getElementById('header-title').onclick = () => navigate('list')

  // 첫 화면 로드
  navigate('list')
})
