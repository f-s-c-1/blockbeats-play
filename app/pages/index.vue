<script setup lang="ts">
const code = ref('')
const router = useRouter()

function joinAsPlayer() {
  const c = code.value.trim().toUpperCase()
  if (c) router.push(`/r/${c}`)
}
</script>

<template>
  <div class="center">
    <div class="home-logo">
      <div class="hero-emoji-row" aria-hidden="true">
        <span class="hero-side">🔥</span>
        <span class="huge">🏇</span>
        <span class="hero-side">⛺</span>
      </div>
      <h1>燃团</h1>
      <p class="hero-tagline">一部手机 · 四十个人 · 一晚上的尖叫</p>
      <p class="muted">主持人控节奏，你的手机就是举牌道具</p>
    </div>

    <div class="home-shell">
      <div class="card hero-card">
        <h2>🎮 我是参与者</h2>
        <p class="muted">输入主持人给的房间码加入</p>
        <div class="grid">
          <input v-model="code" class="code-input" placeholder="房间码（如 ABCD）" maxlength="8" @keyup.enter="joinAsPlayer" />
          <button class="full-width" :disabled="!code.trim()" @click="joinAsPlayer">加入房间</button>
        </div>
      </div>

      <!-- 主持人入口不在明面展示，直接访问 /admin 进入 -->
    </div>
  </div>
</template>

<style scoped>
.hero-emoji-row {
  display: flex;
  align-items: flex-end;
  gap: 14px;
}
.hero-side {
  font-size: 30px;
  opacity: .85;
  animation: heroBob 3.2s ease-in-out infinite;
}
.hero-side:last-child { animation-delay: 1.6s; }
.hero-tagline {
  margin-bottom: 2px;
  font-family: var(--font-display);
  font-size: 17px;
  color: var(--primary);
  letter-spacing: .08em;
}
.hero-card { border-color: rgba(255, 157, 46, .4); }
@media (prefers-reduced-motion: reduce) {
  .hero-side { animation: none; }
}
</style>
