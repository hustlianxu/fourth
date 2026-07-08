// utils/builtinDict.js
// 中-西外贸常用词对照表（双向查询）+ 不翻译的白名单
//
// 命中规则：先长后短（按 es 长度降序匹配，避免 'luz' 抢先匹配 'con luz'）
// 白名单：数字、单位、通用符号、广为流传的英文缩写等保留不翻译

// 不翻译的白名单（精确匹配，区分大小写的不区分）
var WHITELIST = [
  // 单位
  'm³', 'm3', 'cm³', 'cm3', 'kg', 'g', 'mg', 'L', 'ml',
  'pzs', 'pza', 'pzas', 'pcs', 'pc', 'ctn', 'ctns',
  'cajas', 'caja', 'unidades', 'unidad', 'uds',
  // 货币
  'rmb', 'RMB', 'usd', 'USD', 'eur', 'EUR', '$', '¥', '€',
  // 规格/通用缩写
  'RGB', 'LED', 'USB', 'DC', 'AC', 'W', 'V', 'mA', 'Hz',
  // 标点/分隔符
  '×', '·', '-', '/', '+'
];

// 中-西外贸常用词对照（双向）
// 顺序：先放长词组，再放短词，便于先长后短匹配
var BUILTIN_DICT = [
  // 动作/特性（词组优先）
  { zh: '带灯', es: 'con luz' },
  { zh: '不带灯', es: 'sin luz' },
  { zh: '带音乐', es: 'con música' },
  { zh: '不带音乐', es: 'sin música' },
  { zh: '带电池', es: 'con batería' },
  { zh: '不带电池', es: 'sin batería' },
  { zh: '可充电', es: 'recargable' },
  { zh: '防水', es: 'impermeable' },
  { zh: '防尘', es: 'a prueba de polvo' },
  { zh: '可调光', es: 'regulable' },
  { zh: '可拆卸', es: 'desmontable' },
  { zh: '可折叠', es: 'plegable' },
  { zh: '带遥控', es: 'con control remoto' },
  { zh: '不带遥控', es: 'sin control remoto' },
  { zh: '带开关', es: 'con interruptor' },
  { zh: '带挂钩', es: 'con gancho' },
  { zh: '带底座', es: 'con base' },

  // 闪烁模式
  { zh: '闪烁', es: 'destello' },
  { zh: '常亮', es: 'fijo' },
  { zh: '渐变', es: 'degradado' },
  { zh: '跳变', es: 'saltando' },
  { zh: '呼吸', es: 'respiración' },
  { zh: '模式', es: 'modo' },
  { zh: '种模式', es: 'modos' },

  // 产品类别
  { zh: '挂灯', es: 'lámpara colgante' },
  { zh: '台灯', es: 'lámpara de mesa' },
  { zh: '壁灯', es: 'lámpara de pared' },
  { zh: '灯串', es: 'cadena de luces' },
  { zh: '灯带', es: 'tira de luces' },
  { zh: '灯泡', es: 'bombilla' },
  { zh: '灯具', es: 'lámpara' },
  { zh: '星星', es: 'estrellas' },
  { zh: '大星星', es: 'estrellas grandes' },
  { zh: '小星星', es: 'estrellas chicas' },
  { zh: '雪人', es: 'muñeco de nieve' },
  { zh: '圣诞树', es: 'árbol de navidad' },
  { zh: '圣诞', es: 'navidad' },
  { zh: '雪花', es: 'copo de nieve' },
  { zh: '铃铛', es: 'campana' },
  { zh: '蝴蝶结', es: 'lazo' },
  { zh: '礼物盒', es: 'caja de regalo' },
  { zh: '玩偶', es: 'muñeco' },
  { zh: '公仔', es: 'peluche' },

  // 颜色
  { zh: '红色', es: 'rojo' },
  { zh: '蓝色', es: 'azul' },
  { zh: '绿色', es: 'verde' },
  { zh: '白色', es: 'blanco' },
  { zh: '黑色', es: 'negro' },
  { zh: '黄色', es: 'amarillo' },
  { zh: '粉色', es: 'rosa' },
  { zh: '紫色', es: 'morado' },
  { zh: '橙色', es: 'naranja' },
  { zh: '金色', es: 'dorado' },
  { zh: '银色', es: 'plateado' },
  { zh: '暖白', es: 'blanco cálido' },
  { zh: '冷白', es: 'blanco frío' },
  { zh: '彩色', es: 'multicolor' },
  { zh: '透明', es: 'transparente' },

  // 尺寸/规格
  { zh: '大', es: 'grande' },
  { zh: '小', es: 'chico' },
  { zh: '中', es: 'mediano' },
  { zh: '超', es: 'súper' },
  { zh: '迷你', es: 'mini' },
  { zh: '加长', es: 'extra largo' },
  { zh: '长', es: 'largo' },
  { zh: '短', es: 'corto' },
  { zh: '厚', es: 'grueso' },
  { zh: '薄', es: 'delgado' },
  { zh: '高', es: 'alto' },
  { zh: '低', es: 'bajo' },
  { zh: '直径', es: 'diámetro' },
  { zh: '长度', es: 'longitud' },
  { zh: '宽度', es: 'ancho' },
  { zh: '高度', es: 'altura' },

  // 材质
  { zh: '塑料', es: 'plástico' },
  { zh: '金属', es: 'metal' },
  { zh: '玻璃', es: 'vidrio' },
  { zh: '木质', es: 'madera' },
  { zh: '亚克力', es: 'acrílico' },
  { zh: '硅胶', es: 'silicona' },
  { zh: '陶瓷', es: 'cerámica' },
  { zh: '布艺', es: 'tela' },

  // 包装/数量
  { zh: '每箱', es: 'por caja' },
  { zh: '装箱数', es: 'cantidad por caja' },
  { zh: '件数', es: 'total' },
  { zh: '总数', es: 'total' },
  { zh: '套装', es: 'set' },
  { zh: '一盒', es: 'una caja' },
  { zh: '一套', es: 'un set' },
  { zh: '一打', es: 'una docena' },

  // 价格/贸易
  { zh: '单价', es: 'precio unitario' },
  { zh: '总价', es: 'precio total' },
  { zh: '批发价', es: 'precio mayorista' },
  { zh: '零售价', es: 'precio minorista' },
  { zh: '含税', es: 'impuesto incluido' },
  { zh: '不含税', es: 'sin impuesto' },
  { zh: '含运费', es: 'con envío' },
  { zh: '不含运费', es: 'sin envío' },

  // 其他常用
  { zh: '新款', es: 'nuevo modelo' },
  { zh: '老款', es: 'modelo antiguo' },
  { zh: '热销', es: 'más vendido' },
  { zh: '爆款', es: 'éxito de ventas' },
  { zh: '现货', es: 'en stock' },
  { zh: '缺货', es: 'agotado' },
  { zh: '预售', es: 'preventa' },
  { zh: '定制', es: 'personalizado' },
  { zh: '样品', es: 'muestra' },
  { zh: '免运费', es: 'envío gratis' },
  { zh: '包邮', es: 'envío gratis' },

  // 动词/连接词
  { zh: '和', es: 'y' },
  { zh: '与', es: 'y' },
  { zh: '或', es: 'o' },
  { zh: '及', es: 'y' },
  { zh: '加', es: 'más' },
  { zh: '减', es: 'menos' },
  { zh: '带', es: 'con' },
  { zh: '不带', es: 'sin' },

  // 灯光效果
  { zh: '亮', es: 'brillante' },
  { zh: '暗', es: 'oscuro' },
  { zh: '光', es: 'luz' },
  { zh: '灯', es: 'lámpara' },
  { zh: '电', es: 'eléctrico' }
];

module.exports = {
  BUILTIN_DICT: BUILTIN_DICT,
  WHITELIST: WHITELIST
};
