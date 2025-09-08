(function flexible(window, document) {
  function resetFontSize() {
    const docEl = document.documentElement;
    const clientWidth = docEl.clientWidth;
    
    // 根据不同屏幕尺寸设置不同的基准，调整为100%缩放下合适的大小
    let baseSize = 13; // 默认基准字体大小
    
    if (clientWidth >= 1920) {
      // 大屏幕：基于1920px
      baseSize = (clientWidth / 1920) * 13;
    } else if (clientWidth >= 1200) {
      // 中大屏幕：基于1200px
      baseSize = (clientWidth / 1200) * 12.5;
    } else if (clientWidth >= 768) {
      // 平板：基于768px
      baseSize = (clientWidth / 768) * 12;
    } else {
      // 手机：基于375px，最小10px
      baseSize = Math.max((clientWidth / 375) * 11, 10);
    }
    
    // 限制字体大小范围
    baseSize = Math.min(Math.max(baseSize, 10), 16);
    
    docEl.style.fontSize = baseSize + 'px';
  }

  // 初始化
  resetFontSize();
  
  // 监听事件
  window.addEventListener('pageshow', resetFontSize);
  window.addEventListener('resize', resetFontSize);
  window.addEventListener('orientationchange', function() {
    setTimeout(resetFontSize, 100);
  });
})(window, document);
