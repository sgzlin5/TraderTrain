// Vela zh-Hans 语言包：覆盖绘图工作流可见文本（工具名 / 设置弹窗字段 / 悬浮条 / 对话框按钮）。
// 未覆盖的键自动回退英文；补键直接往 PACK 里加即可。
// 用法（vela-ind.js 已接）：registerLocale('zh-Hans', PACK) —— setLocale('zh-Hans') 时生效。
const PACK = {
  // —— 对话框按钮 / 页签（指标与绘图设置共用） ——
  'chart.indicatorSettings.cancel': '取消',
  'chart.indicatorSettings.ok': '确定',
  'chart.indicatorSettings.close': '关闭',
  'chart.indicatorSettings.inputsTab': '输入',
  'chart.indicatorSettings.propertiesTab': '属性',
  'chart.indicatorSettings.resetDefaults': '恢复默认',
  'chart.indicatorSettings.selectSymbol': '选择标的',
  'chart.indicatorSettings.timeframe.chart': '图表',
  'chart.indicatorSettings.timeframe.minutes': '分钟',
  'chart.indicatorSettings.timeframe.hours': '小时',
  'chart.indicatorSettings.timeframe.day': '天',
  'chart.indicatorSettings.timeframe.week': '周',
  'chart.indicatorSettings.timeframe.month': '月',

  // —— 绘图设置弹窗字段 ——
  'drawing.settings.line': '线条',
  'drawing.settings.style': '样式',
  'drawing.settings.label': '标签',
  'drawing.settings.points': '点位',
  'drawing.settings.showOn': '显示周期',
  'drawing.settings.allTimeframes': '全部周期',
  'drawing.settings.chartTimeframe': '仅图表周期',
  'drawing.settings.custom': '自定义',
  'drawing.settings.addALabel': '添加标签',
  'drawing.settings.extend': '延伸',
  'drawing.settings.extendLeft': '向左延伸',
  'drawing.settings.extendRight': '向右延伸',
  'drawing.settings.extendBothWays': '双向延伸',
  'drawing.settings.dontExtend': '不延伸',
  'drawing.settings.end': '终点',
  'drawing.settings.ends': '端点',
  'drawing.settings.start': '起点',
  'drawing.settings.arrow': '箭头',
  'drawing.settings.endArrow': '终点箭头',
  'drawing.settings.background': '背景',
  'drawing.settings.above': '上方',
  'drawing.settings.below': '下方',
  'drawing.settings.bold': '加粗',
  'drawing.settings.all': '全部',
  'drawing.settings.deleteStyle': '删除样式',

  // —— 选中悬浮条 ——
  'drawing.bar.settings': '设置',
  'drawing.bar.lock': '锁定',
  'drawing.bar.delete': '删除',
  'drawing.bar.more': '更多',
  'drawing.bar.inUse': '使用中',
  'drawing.bar.duplicate': '创建副本',
  'drawing.bar.bringToFront': '置顶',
  'drawing.bar.sendToBack': '置底',
  'drawing.bar.resetSettings': '恢复默认',
  'drawing.bar.lineColor': '线条颜色',
  'drawing.bar.lineWidth': '线宽',
  'drawing.bar.lineStyle': '线型',
  'drawing.bar.fill': '填充',

  // —— 常用工具名（官方工具栏提示 / 图例） ——
  'drawing.trendline.label': '趋势线',
  'drawing.hline.label': '水平线',
  'drawing.ray.label': '射线',
  'drawing.extendedline.label': '延伸线',
  'drawing.vline.label': '垂直线',
  'drawing.hray.label': '水平射线',
  'drawing.crossline.label': '十字线',
  'drawing.infoline.label': '信息线',
  'drawing.trendangle.label': '角度线',
  'drawing.box.label': '矩形',
  'drawing.text.label': '文本',
  'drawing.note.label': '便签',
  'drawing.comment.label': '注释',
  'drawing.pricenote.label': '价格便签',
  'drawing.pricelabel.label': '价格标签',
  'drawing.signpost.label': '路标',
  'drawing.parallelchannel.label': '平行通道',
  'drawing.disjointchannel.label': '分离通道',
  'drawing.flattopbottom.label': '平顶平底通道',
  'drawing.regressionchannel.label': '回归通道',
  'drawing.anchoredvwap.label': '锚定 VWAP',
  'drawing.fixedrangevp.label': '区间成交量分布',
  'drawing.pitchfork.label': '叉线',
  'drawing.schiffpitchfork.label': '希夫叉线',
  'drawing.modifiedschiffpitchfork.label': '修正希夫叉线',
  'drawing.insidepitchfork.label': '内置叉线',
  'drawing.arrow.label': '箭头',
  'drawing.callout.label': '标注',
  'drawing.ellipse.label': '椭圆',
  'drawing.triangle.label': '三角形',
  'drawing.polyline.label': '折线',
  'drawing.freehand.label': '自由画笔',
  'drawing.highlighter.label': '荧光笔',
  'drawing.circle.label': '圆',
  'drawing.rotatedrect.label': '旋转矩形',
  'drawing.path.label': '路径',
  'drawing.arc.label': '弧线',
  'drawing.curve.label': '曲线',
  'drawing.arrowmarkup.label': '上涨箭头',
  'drawing.arrowmarkdown.label': '下跌箭头',
  'drawing.flagmark.label': '旗帜标记',
  'drawing.iconstamp.label': '图标戳',
  'drawing.fibretracement.label': '斐波那契回撤',
  'drawing.fibextension.label': '斐波那契扩展',
  'drawing.fibextensiontrend.label': '斐波那契趋势扩展',
  'drawing.fibfan.label': '斐波那契扇形',
  'drawing.fibtimezones.label': '斐波那契时区',
  'drawing.fibchannel.label': '斐波那契通道',
  'drawing.fibspeedfan.label': '斐波那契速度扇',
  'drawing.trendfibtime.label': '趋势斐波时间',
  'drawing.fibcircles.label': '斐波那契圆',
  'drawing.fibarcs.label': '斐波那契弧',
  'drawing.fibwedge.label': '斐波那契楔形',
  'drawing.fibspiral.label': '斐波那契螺旋',
  'drawing.gannfan.label': '甘氏扇形',
  'drawing.gannbox.label': '甘氏箱',
  'drawing.gannsquare.label': '甘氏方格',
  'drawing.datepricerange.label': '日期价格范围',
  'drawing.position.label': '持仓',
  'drawing.magnifier.label': '放大镜',
  'drawing.xabcd.label': 'XABCD 形态',
  'drawing.abcd.label': 'ABCD 形态',
  'drawing.elliottimpulse.label': '艾略特推动浪',
  'drawing.elliottcorrection.label': '艾略特修正浪',
  'drawing.headshoulders.label': '头肩形态',
  'drawing.gartley.label': '加特利',
  'drawing.bat.label': '蝙蝠',
  'drawing.butterfly.label': '蝴蝶',
  'drawing.crab.label': '螃蟹',
  'drawing.shark.label': '鲨鱼',
  'drawing.cypher.label': '赛福',
  'drawing.fairvaluegap.label': '公允价值缺口',
  'drawing.orderblock.label': '订单块',
  'drawing.liquidity.label': '流动性',

  // —— 图例 / 常用 chrome ——
  'chart.legend.settings': '设置',
  'chart.legend.hide': '隐藏',
  'chart.legend.show': '显示',
  'chart.legend.remove': '移除',
  'chart.legend.indicators': '指标',
  'chart.legend.hideLegend': '收起图例',
  'chart.legend.showLegend': '展开图例',
  'chart.pane.mainChart': '主图',
  'chart.scrollToLatest.title': '滚动到最新 K 线',
  'chart.scrollToLatest.label': '跳到最新'
};

/** 工具类型 → 中文名（查 PACK 表，无则回退英文类型名） */
export function labelZh(type) {
  const zh = PACK['drawing.' + type + '.label'];
  return typeof zh === 'string' ? zh : type;
}

export function registerVelaZhHans(V) {
  const registerLocale = V?.registerLocale;
  if (typeof registerLocale !== 'function') return false;
  try {
    registerLocale({ locale: 'zh-Hans', messages: PACK });   // 签名为对象参数（实测）
    return true;
  } catch (e) {
    console.warn('[vela:locale]', e?.message);
    return false;
  }
}
