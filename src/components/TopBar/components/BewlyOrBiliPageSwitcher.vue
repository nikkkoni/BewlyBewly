<script lang="ts" setup>
import { useBewlyApp } from '~/composables/useAppProvider'
import { IFRAME_PAGE_SWITCH_BEWLY, IFRAME_PAGE_SWITCH_BILI } from '~/constants/globalEvents'
import { settings } from '~/logic'
import { useMainStore } from '~/stores/mainStore'
// import { useSettingsStore } from '~/stores/settingsStore'
import { isHomePage, isInIframe } from '~/utils/main'

const { activatedPage } = useBewlyApp()
const { getDockItemByPage } = useMainStore()
// const { getDockItemConfigByPage } = useSettingsStore()
const options = readonly([
  {
    name: 'BewlyBewly',
    shortName: 'Bewly',
    useOriginalBiliPage: false,
  },
  {
    name: 'BiliBili',
    shortName: 'Bili',
    useOriginalBiliPage: true,
  },
])

const showBewlyOrBiliPageSwitcher = computed(() => {
  if (settings.value.useOriginalBilibiliHomepage)
    return false
  if (!isInIframe() && getDockItemByPage(activatedPage.value)?.hasBewlyPage && isHomePage())
    return true
  if (isInIframe() && getDockItemByPage(activatedPage.value)?.hasBewlyPage)
    return true
  // const dockItemConfig = getDockItemConfigByPage(activatedPage.value)
  // if (dockItemConfig?.useOriginalBiliPage && isInIframe())
  //   return true
  return false
})

function switchPage(useOriginalBiliPage: boolean) {
  const dockItem = settings.value.dockItemsConfig.find(dockItem => dockItem.page === activatedPage.value)
  if (dockItem) {
    dockItem.useOriginalBiliPage = useOriginalBiliPage
  }

  if (isInIframe()) {
    if (useOriginalBiliPage)
      parent.postMessage(IFRAME_PAGE_SWITCH_BILI, '*')
    else
      parent.postMessage(IFRAME_PAGE_SWITCH_BEWLY, '*')
  }
}
</script>

<template>
  <div
    v-if="showBewlyOrBiliPageSwitcher"
    class="bewly-bili-switcher"
    flex="~ gap-1"
    h-34px
  >
    <button
      v-for="option in options" :key="option.name"
      class="bewly-bili-switcher-button"
      :class="{
        active: option.useOriginalBiliPage === isInIframe(),
      }"
      relative text="$bew-text-2 hover:$bew-text-1 xs" p="x-2 lg:x-3"
      fw-bold duration-300
      @click="switchPage(option.useOriginalBiliPage)"
    >
      <span class="hidden lg:block">
        {{ option.name }}
      </span>
      <span class="block lg:hidden">
        {{ option.shortName }}
      </span>
    </button>
  </div>
</template>

<style lang="scss" scoped>
.force-white-icon .bewly-bili-switcher-button {
  --uno: "text-white";
}

.active {
  --uno: "text-$bew-text-1";

  &::after {
    content: "";
    position: absolute;
    inset: auto 12px 0;
    height: 2px;
    border-radius: 2px;
    background: currentColor;
  }
}
</style>
