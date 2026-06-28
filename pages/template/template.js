// pages/template/template.js
const templates = require('../../utils/templates.js');
const storage = require('../../utils/storage.js');

const POSITIONS = [
  { id: 'top-left', label: '左上' },
  { id: 'top-center', label: '上中' },
  { id: 'top-right', label: '右上' },
  { id: 'center-left', label: '左中' },
  { id: 'center', label: '正中' },
  { id: 'center-right', label: '右中' },
  { id: 'bottom-left', label: '左下' },
  { id: 'bottom-center', label: '下中' },
  { id: 'bottom-right', label: '右下' }
];

const FIELD_TYPES = [
  { id: 'text', label: '文本' },
  { id: 'number', label: '数字' },
  { id: 'textarea', label: '多行文本' },
  { id: 'select', label: '选择' },
  { id: 'datetime', label: '日期时间' },
  { id: 'date', label: '日期' },
  { id: 'time', label: '时间' },
  { id: 'location', label: '位置' }
];

Page({
  data: {
    templates: [],
    showModal: false,
    hasModal: false,
    editingId: null,
    form: {
      name: '',
      description: '',
      position: 'bottom-right',
      style: {
        fontSize: 22,
        color: '#ffffff',
        background: 'rgba(0,0,0,0.7)',
        padding: 14,
        borderRadius: 10,
        lineHeight: 1.7
      },
      fields: []
    },
    POSITIONS: POSITIONS,
    FIELD_TYPES: FIELD_TYPES,
    showDeleteConfirm: false,
    deleteName: '',
    deleteId: ''
  },


  onLoad() {
    this.loadTemplates();
  },

  // 加载模板（内置 + 自定义）
  loadTemplates() {
    const builtIn = templates.TEMPLATES;
    const custom = storage.getCustomTemplates() || [];
    const all = [...custom, ...builtIn];
    this.setData({ templates: all });
  },

  // 获取位置标签
  getPosLabel(pos) {
    const item = POSITIONS.find(p => p.id === pos);
    return item ? item.label : pos;
  },

  // 新增模板
  onAdd() {
    this.setData({
        showModal: true,
        hasModal: true,
        editingId: null,
      form: {
        name: '',
        description: '',
        position: 'bottom-right',
        style: {
          fontSize: 22,
          color: '#ffffff',
          background: 'rgba(0,0,0,0.7)',
          padding: 14,
          borderRadius: 10,
          lineHeight: 1.7
        },
        fields: []
      }
    });
  },

  // 编辑模板（仅自定义模板可编辑）
  onEdit(e) {
    const id = e.currentTarget.dataset.id;
    const customTpls = storage.getCustomTemplates() || [];
    const tpl = customTpls.find(t => t.id === id);
    if (tpl) {
      this.setData({
        showModal: true,
        hasModal: true,
        editingId: id,
        form: JSON.parse(JSON.stringify(tpl))
      });
    } else {
      wx.showToast({ title: '内置模板不可编辑', icon: 'none' });
    }
  },

  // 卡片操作菜单
  onCardActions(e) {
    const id = e.currentTarget.dataset.id;
    const customTpls = storage.getCustomTemplates() || [];
    const tpl = customTpls.find(t => t.id === id);
    if (tpl) {
      this.setData({
        showDeleteConfirm: true,
        hasModal: true,
        deleteName: tpl.name,
        deleteId: id
      });
    }
  },

  // 表单输入
  onFormInput(e) {
    const key = e.currentTarget.dataset.key;
    const val = e.detail.value;
    this.setData({ [`form.${key}`]: val });
  },

  // 样式输入
  onStyleInput(e) {
    const key = e.currentTarget.dataset.key;
    const val = parseInt(e.detail.value) || 0;
    this.setData({ [`form.style.${key}`]: val });
  },

  // 设置位置
  onSetPos(e) {
    const pos = e.currentTarget.dataset.pos;
    this.setData({ 'form.position': pos });
  },

  // 设置背景色
  onSetBgColor(e) {
    const color = e.currentTarget.dataset.color;
    this.setData({ 'form.style.background': color });
  },

  // 设置文字颜色
  onSetTextColor(e) {
    const color = e.currentTarget.dataset.color;
    this.setData({ 'form.style.color': color });
  },

  // 添加字段
  onAddField() {
    const fields = [...this.data.form.fields, {
      key: `field_${Date.now()}`,
      label: '',
      type: 'text',
      placeholder: '',
      required: false,
      options: []
    }];
    this.setData({ 'form.fields': fields });
  },

  // 字段标签输入
  onFieldLabelInput(e) {
    const idx = e.currentTarget.dataset.index;
    const val = e.detail.value;
    const fields = [...this.data.form.fields];
    fields[idx].label = val;
    // 自动生成 key
    if (val) {
      const key = val.replace(/[··/\\\s]/g, '_').toLowerCase().slice(0, 20) || `field_${idx}`;
      fields[idx].key = key;
    }
    this.setData({ 'form.fields': fields });
  },

  // 字段类型选择
  onFieldTypeChange(e) {
    const idx = e.currentTarget.dataset.index;
    const typeInfo = FIELD_TYPES[e.detail.value];
    const fields = [...this.data.form.fields];
    fields[idx].type = typeInfo.id;
    // options 字段可能缺失（旧数据迁移等），做空数组防护避免 TypeError
    if (typeInfo.id === 'select' && (!fields[idx].options || !fields[idx].options.length)) {
      fields[idx].options = ['选项1', '选项2', '选项3'];
    }
    this.setData({ 'form.fields': fields });
  },

  // 删除字段
  onRemoveField(e) {
    const idx = e.currentTarget.dataset.index;
    const fields = this.data.form.fields.filter((_, i) => i !== idx);
    this.setData({ 'form.fields': fields });
  },

  // 保存模板
  onSave() {
    const form = this.data.form;
    if (!form.name.trim()) {
      wx.showToast({ title: '请输入模板名称', icon: 'none' });
      return;
    }
    if (!form.fields.length) {
      wx.showToast({ title: '请至少添加一个字段', icon: 'none' });
      return;
    }
    // 检查必填字段
    const hasEmptyLabel = form.fields.some(f => !f.label.trim());
    if (hasEmptyLabel) {
      wx.showToast({ title: '请填写所有字段标签', icon: 'none' });
      return;
    }

    const template = {
      id: this.data.editingId || `custom_${Date.now()}`,
      name: form.name,
      description: form.description,
      position: form.position,
      style: {
        fontSize: form.style.fontSize || 22,
        color: form.style.color || '#ffffff',
        background: form.style.background || 'rgba(0,0,0,0.7)',
        padding: form.style.padding || 14,
        borderRadius: form.style.borderRadius || 10,
        lineHeight: form.style.lineHeight || 1.7
      },
      fields: form.fields.map(f => ({
        key: f.key || `field_${Date.now()}`,
        label: f.label,
        type: f.type || 'text',
        placeholder: f.placeholder || '',
        required: !!f.required,
        options: f.options || []
      }))
    };

    storage.saveCustomTemplate(template);
    this.closeModal();
    this.loadTemplates();
    wx.showToast({ title: '保存成功', icon: 'success' });
  },

  // 删除模板
  onDelete() {
    storage.deleteCustomTemplate(this.data.deleteId);
    this.cancelDelete();
    this.loadTemplates();
    wx.showToast({ title: '已删除', icon: 'success' });
  },

  // 取消删除
  cancelDelete() {
    this.setData({ showDeleteConfirm: false, hasModal: false, deleteName: '', deleteId: '' });
  },

  // 获取字段类型名称
  getFieldTypeName(type) {
    const found = FIELD_TYPES.find(t => t.id === type);
    return found ? found.label : '文本';
  },

  // 关闭弹窗
  closeModal() {
    this.setData({ showModal: false, hasModal: false, editingId: null });
  }
});
