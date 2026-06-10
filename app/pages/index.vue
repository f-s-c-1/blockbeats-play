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
      <div class="huge">🏇</div>
      <h1>草原杯</h1>
      <p class="muted">现场互动 · 主持人控节奏，参与者手机接收</p>
    </div>

    <div class="home-shell">
      <div class="card">
        <h2>参与者</h2>
        <p class="muted">输入主持人给的房间码加入</p>
        <div class="grid">
          <input v-model="code" class="code-input" placeholder="房间码（如 ABCD）" maxlength="8" @keyup.enter="joinAsPlayer" />
          <button class="full-width" :disabled="!code.trim()" @click="joinAsPlayer">加入房间</button>
        </div>
      </div>

      <div class="card">
        <h2>主持人</h2>
        <p class="muted">创建房间、控制全场节奏</p>
        <NuxtLink to="/admin"><button class="ghost full-width">进入控制台</button></NuxtLink>
      </div>
    </div>
  </div>
</template>
