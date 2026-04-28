/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Empty,
  Image,
  InputNumber,
  Select,
  Spin,
  Tabs,
  TabPane,
  Tag,
  TextArea,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import {
  IconImage,
  IconDownload,
  IconBolt,
  IconCopy,
  IconClose,
  IconPlus,
} from '@douyinfe/semi-icons';
import {
  API,
  processGroupsData,
  processModelsData,
  showError,
  showSuccess,
} from '../../helpers';
import { renderQuota } from '../../helpers/render';
import { UserContext } from '../../context/User';

const { Text, Title } = Typography;

const ASPECT_OPTIONS = [
  { label: '1:1 方图', value: '1024x1024' },
  { label: '2:3 竖图', value: '1024x1536' },
  { label: '3:2 横图', value: '1536x1024' },
  { label: '9:16 手机竖屏', value: '1024x1792' },
  { label: '16:9 宽屏', value: '1792x1024' },
  { label: '自动', value: 'auto' },
];

const PROMPT_PRESETS = [
  '电影感清晨薄雾森林特写，柔和金光，超写实',
  '极简主义产品大片：一台手机置于大理石台面，工作室灯光，写实质感',
  '赛博朋克霓虹城市，雨夜，湿漉反光的街道，银翼杀手氛围',
  '可爱 3D 等距小房间，马卡龙色系，blender 风格，octane 渲染',
];

const isImageGenModel = (m) => {
  if (!m) return false;
  const v = (m.value || m).toString().toLowerCase();
  return v.startsWith('gpt-image') || v.startsWith('dall-e') || v.includes('image');
};

const ImageStudio = () => {
  const { t } = useTranslation();
  const [userState, userDispatch] = useContext(UserContext);

  const [groups, setGroups] = useState([]);
  const [models, setModels] = useState([]);
  const [group, setGroup] = useState('');
  const [model, setModel] = useState('gpt-image-2');
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1024x1024');
  const [n, setN] = useState(1);

  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [lastCost, setLastCost] = useState(null); // 上次本次消耗的 quota

  // 价格表与分组倍率（用于生成前预估费用）
  const [pricingMap, setPricingMap] = useState({}); // model -> pricing entry
  const [groupRatioMap, setGroupRatioMap] = useState({}); // group -> ratio

  // 模式：t2i = 文生图 / i2i = 图生图
  const [mode, setMode] = useState('t2i');
  const [refFiles, setRefFiles] = useState([]); // File[]
  const fileInputRef = useRef(null);
  const [refPreviews, setRefPreviews] = useState([]); // string[] dataURL

  // 当 refFiles 变化时生成预览 URL
  useEffect(() => {
    let revoked = [];
    const urls = refFiles.map((f) => {
      const u = URL.createObjectURL(f);
      revoked.push(u);
      return u;
    });
    setRefPreviews(urls);
    return () => revoked.forEach((u) => URL.revokeObjectURL(u));
  }, [refFiles]);

  const onPickFiles = (e) => {
    const files = Array.from(e.target.files || []).filter((f) =>
      f.type.startsWith('image/'),
    );
    if (files.length === 0) return;
    setRefFiles((prev) => [...prev, ...files].slice(0, 6));
    e.target.value = '';
  };
  const removeRef = (idx) =>
    setRefFiles((prev) => prev.filter((_, i) => i !== idx));

  const loadGroups = useCallback(async () => {
    try {
      const res = await API.get('/api/user/self/groups');
      const { success, data } = res.data;
      if (success) {
        const userGroup =
          userState?.user?.group ||
          JSON.parse(localStorage.getItem('user') || '{}')?.group;
        const opts = processGroupsData(data || {}, userGroup);
        setGroups(opts);
        if (opts.length > 0 && !group) setGroup(opts[0].value);
      }
    } catch (e) {}
  }, [userState?.user?.group, group]);

  const loadModels = useCallback(
    async (g) => {
      try {
        const q = g ? `?group=${encodeURIComponent(g)}` : '';
        const res = await API.get(`/api/user/models${q}`);
        const { success, data } = res.data;
        if (success) {
          const { modelOptions } = processModelsData(data, model);
          const imageOnly = modelOptions.filter(isImageGenModel);
          setModels(imageOnly);
          if (imageOnly.length > 0 && !imageOnly.some((m) => m.value === model)) {
            setModel(imageOnly[0].value);
          }
        }
      } catch (e) {}
    },
    [model],
  );

  useEffect(() => {
    loadGroups();
    // 拉取价格表
    (async () => {
      try {
        const r = await API.get('/api/pricing');
        if (r.data?.success && r.data?.data) {
          const map = {};
          (r.data.data || []).forEach((p) => {
            map[p.model_name] = p;
          });
          setPricingMap(map);
          setGroupRatioMap(r.data.group_ratio || {});
        }
      } catch (e) {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadModels(group);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group]);

  const canGenerate = useMemo(() => {
    if (loading || !model || !prompt.trim()) return false;
    if (mode === 'i2i' && refFiles.length === 0) return false;
    return true;
  }, [loading, model, prompt, mode, refFiles]);

  // 计算 dall-e 系列的 size & quality 系数，gpt-image / 其他默认 1
  const computeSizeRatio = (m, s) => {
    if (!m || !m.toLowerCase().startsWith('dall-e')) return 1;
    if (s === '256x256') return 0.4;
    if (s === '512x512') return 0.45;
    if (s === '1024x1024') return 1;
    if (s === '1024x1792' || s === '1792x1024') return 2;
    return 1;
  };

  // 预估本次生成费用（quota 单位）
  const estimatedQuota = useMemo(() => {
    const p = pricingMap[model];
    if (!p) return null;
    const QUOTA_PER_UNIT = Number(
      localStorage.getItem('quota_per_unit') || 500000,
    );
    const groupRatio = Number(groupRatioMap[group] ?? 1) || 1;
    const sizeRatio = computeSizeRatio(model, size);
    const count = Math.max(1, Number(n) || 1);
    if (p.quota_type === 1 && p.model_price > 0) {
      // 按次计费：modelPrice(USD) * QuotaPerUnit * groupRatio * sizeRatio * n
      return p.model_price * QUOTA_PER_UNIT * groupRatio * sizeRatio * count;
    }
    if (p.quota_type === 0 && p.image_ratio && p.model_ratio) {
      // 按 token 计费近似：使用 image_ratio * model_ratio * groupRatio * n
      return (
        p.image_ratio * p.model_ratio * QUOTA_PER_UNIT * groupRatio * count
      );
    }
    return null;
  }, [pricingMap, groupRatioMap, model, group, size, n]);

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setLoading(true);
    try {
      let res;
      if (mode === 'i2i') {
        const fd = new FormData();
        fd.append('group', group);
        fd.append('model', model);
        fd.append('prompt', prompt.trim());
        fd.append('n', String(n));
        fd.append('size', size);
        refFiles.forEach((f) => {
          // OpenAI 协议：单图用 'image'，多图用 'image[]'
          fd.append(refFiles.length > 1 ? 'image[]' : 'image', f, f.name);
        });
        res = await API.post('/pg/images/edits', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 5 * 60 * 1000,
        });
      } else {
        const body = {
          group,
          model,
          prompt: prompt.trim(),
          n,
          size,
        };
        res = await API.post('/pg/images/generations', body, {
          timeout: 5 * 60 * 1000,
        });
      }
      const data = res.data;

      let images = [];
      if (Array.isArray(data?.data)) images = data.data;
      else if (Array.isArray(data?.data?.data)) images = data.data.data;
      else if (data?.success === false) {
        showError(data.message || t('生成失败'));
        return;
      }

      if (images.length === 0) {
        showError(t('未返回图片，请检查模型与配额'));
        return;
      }

      const ts = Date.now();
      const newItems = images.map((it, idx) => {
        let src = '';
        let ext = 'png';
        if (it.url) {
          src = it.url;
          const m = it.url.match(/\.(png|jpe?g|webp|gif)(\?|$)/i);
          if (m) ext = m[1].toLowerCase().replace('jpeg', 'jpg');
        } else if (it.b64_json) {
          src = `data:image/png;base64,${it.b64_json}`;
        }
        return {
          id: `${ts}-${idx}`,
          src,
          ext,
          model,
          prompt: prompt.trim(),
          size,
          mode,
          ts,
          batchId: `b-${ts}`,
          batchSize: images.length,
          cost: null, // 待 600ms 后回填
        };
      });
      const batchId = newItems[0].batchId;
      setResults((prev) => [...newItems, ...prev]);
      showSuccess(t('生成成功'));

      // 刷新用户余额并计算本次消耗，回填到 batch
      const before = Number(userState?.user?.quota || 0);
      setTimeout(async () => {
        try {
          const r = await API.get('/api/user/self');
          if (r.data?.success && r.data?.data) {
            userDispatch({ type: 'login', payload: r.data.data });
            const after = Number(r.data.data.quota || 0);
            const diff = before - after;
            if (diff > 0) {
              setLastCost(diff);
              setResults((prev) =>
                prev.map((it) =>
                  it.batchId === batchId ? { ...it, cost: diff } : it,
                ),
              );
            }
          }
        } catch (e) {}
      }, 600);
    } catch (e) {
      const msg =
        e?.response?.data?.error?.message ||
        e?.response?.data?.message ||
        e?.message ||
        t('生成失败');
      showError(msg);
    } finally {
      setLoading(false);
    }
  };

  const downloadOne = async (item) => {
    const filename = `${item.model}-${item.id}.${item.ext || 'png'}`;
    if (item.src.startsWith('data:')) {
      const a = document.createElement('a');
      a.href = item.src;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    try {
      const r = await fetch(item.src, { mode: 'cors', credentials: 'omit' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      try {
        window.open(item.src, '_blank', 'noopener,noreferrer');
        showSuccess(t('已在新标签打开图片，请右键另存'));
      } catch {
        showError(t('下载失败，请尝试右键图片另存'));
      }
    }
  };

  const reusePrompt = (item) => {
    setPrompt(item.prompt);
    setSize(item.size);
    setModel(item.model);
    showSuccess(t('已回填参数'));
  };

  const removeOne = (id) => {
    setResults((prev) => prev.filter((x) => x.id !== id));
  };

  // 把结果图作为参考图加入 i2i 上传列表
  const useAsReference = async (item) => {
    try {
      let blob;
      if (item.src.startsWith('data:')) {
        const r = await fetch(item.src);
        blob = await r.blob();
      } else {
        // 远程图：尝试 fetch；CORS 失败则提示用户手动下载后上传
        try {
          const r = await fetch(item.src, { mode: 'cors' });
          if (!r.ok) throw new Error('fetch failed');
          blob = await r.blob();
        } catch (e) {
          showError(
            t('该图片受跨域限制，无法直接拾取，请右键另存后手动上传'),
          );
          return;
        }
      }
      const ext = item.ext || 'png';
      const file = new File([blob], `ref-${item.id}.${ext}`, {
        type: blob.type || `image/${ext}`,
      });
      setRefFiles((prev) => {
        if (prev.length >= 6) {
          showError(t('参考图最多 6 张'));
          return prev;
        }
        return [...prev, file];
      });
      if (mode !== 'i2i') setMode('i2i');
      showSuccess(t('已加入参考图'));
    } catch (e) {
      showError(t('拾取失败：') + (e?.message || ''));
    }
  };

  const clearAll = () => setResults([]);

  return (
    <div className='mt-[60px] px-3 sm:px-6 pb-10 max-w-[1600px] mx-auto'>
      {/* Hero / 标题 */}
      <div className='flex items-end justify-between flex-wrap gap-3 mb-5'>
        <div>
          <Title heading={3} className='!mb-1 flex items-center gap-2'>
            <span className='inline-flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white shadow-md'>
              <IconImage />
            </span>
            {t('AI 画室')}
          </Title>
          <Text type='tertiary'>
            {t('描述你脑海中的画面，让 AI 帮你即刻成像')}
          </Text>
        </div>
        <div className='flex items-center gap-2 flex-wrap'>
          {/* 余额信息条 */}
          <div className='flex items-center gap-3 px-3 py-2 rounded-xl border border-semi-color-border bg-semi-color-bg-1 shadow-sm text-sm'>
            <div className='flex flex-col items-end leading-tight'>
              <span className='text-[11px] text-semi-color-text-2'>{t('余额')}</span>
              <span className='font-semibold text-emerald-600 dark:text-emerald-400'>
                {renderQuota(userState?.user?.quota || 0, 4)}
              </span>
            </div>
            <div className='w-px h-6 bg-semi-color-border' />
            <div className='flex flex-col items-end leading-tight'>
              <span className='text-[11px] text-semi-color-text-2'>{t('累计已用')}</span>
              <span className='font-medium'>
                {renderQuota(userState?.user?.used_quota || 0, 2)}
              </span>
            </div>
            {lastCost != null && (
              <>
                <div className='w-px h-6 bg-semi-color-border' />
                <div className='flex flex-col items-end leading-tight'>
                  <span className='text-[11px] text-semi-color-text-2'>{t('上次消耗')}</span>
                  <span className='font-medium text-rose-500'>
                    -{renderQuota(lastCost, 4)}
                  </span>
                </div>
              </>
            )}
          </div>
          {results.length > 0 && (
            <Button
              type='tertiary'
              icon={<IconClose />}
              onClick={clearAll}
              size='small'
            >
              {t('清空结果')}
            </Button>
          )}
        </div>
      </div>

      <div className='grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-5'>
        {/* 控制面板 */}
        <div className='lg:sticky lg:top-[76px] self-start'>
          <div className='rounded-2xl border border-semi-color-border bg-semi-color-bg-1 shadow-sm p-4 flex flex-col gap-4'>
            {/* 模式切换 */}
            <Tabs
              type='button'
              size='small'
              activeKey={mode}
              onChange={setMode}
            >
              <TabPane tab={t('文生图')} itemKey='t2i' />
              <TabPane tab={t('图生图')} itemKey='i2i' />
            </Tabs>

            {/* 模型 + 分组 紧凑一组 */}
            <div className='grid grid-cols-2 gap-3'>
              <div>
                <Text size='small' type='tertiary'>{t('分组')}</Text>
                <Select
                  className='!w-full mt-1'
                  value={group}
                  onChange={setGroup}
                  optionList={groups.map((g) => ({
                    label: `${g.label}${g.ratio != null ? ` ×${g.ratio}` : ''}`,
                    value: g.value,
                  }))}
                  placeholder={t('选择分组')}
                />
              </div>
              <div>
                <Text size='small' type='tertiary'>{t('模型')}</Text>
                <Select
                  className='!w-full mt-1'
                  value={model}
                  onChange={setModel}
                  optionList={models.map((m) => ({
                    label: m.label || m.value,
                    value: m.value,
                  }))}
                  placeholder={t('选择图像模型')}
                  filter
                  showClear
                />
              </div>
            </div>

            {/* Prompt - 主角 */}
            <div>
              <div className='flex items-center justify-between mb-1'>
                <Text strong>{t('提示词')}</Text>
                <Text size='small' type='tertiary'>{prompt.length}/4000</Text>
              </div>
              <TextArea
                value={prompt}
                onChange={setPrompt}
                rows={6}
                maxLength={4000}
                showClear
                autosize={{ minRows: 6, maxRows: 14 }}
                placeholder={t('描述你想要的画面…')}
              />
              <div className='flex flex-wrap gap-1.5 mt-2'>
                {PROMPT_PRESETS.map((p, i) => (
                  <Tooltip key={i} content={p}>
                    <Tag
                      color='violet'
                      type='light'
                      onClick={() => setPrompt(p)}
                      className='cursor-pointer'
                    >
                      ✨ {t('灵感')} {i + 1}
                    </Tag>
                  </Tooltip>
                ))}
              </div>
            </div>

            {/* 图生图：参考图上传 */}
            {mode === 'i2i' && (
              <div>
                <div className='flex items-center justify-between mb-2'>
                  <Text strong>
                    {t('参考图')}{' '}
                    <Text type='tertiary' size='small'>
                      ({refFiles.length}/6)
                    </Text>
                  </Text>
                  {refFiles.length > 0 && (
                    <Button
                      size='small'
                      type='tertiary'
                      onClick={() => setRefFiles([])}
                    >
                      {t('清空')}
                    </Button>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type='file'
                  accept='image/*'
                  multiple
                  className='hidden'
                  onChange={onPickFiles}
                />
                <div className='grid grid-cols-3 gap-2'>
                  {refPreviews.map((src, idx) => (
                    <div
                      key={idx}
                      className='group relative aspect-square rounded-lg overflow-hidden border border-semi-color-border bg-semi-color-bg-2'
                    >
                      <img
                        src={src}
                        alt=''
                        className='w-full h-full object-cover'
                      />
                      <button
                        onClick={() => removeRef(idx)}
                        className='absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition flex items-center justify-center'
                        type='button'
                      >
                        <IconClose size='small' />
                      </button>
                    </div>
                  ))}
                  {refFiles.length < 6 && (
                    <button
                      type='button'
                      onClick={() => fileInputRef.current?.click()}
                      className='aspect-square rounded-lg border-2 border-dashed border-semi-color-border hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/10 flex flex-col items-center justify-center text-semi-color-text-2 transition'
                    >
                      <IconPlus size='large' />
                      <span className='text-xs mt-1'>{t('添加')}</span>
                    </button>
                  )}
                </div>
                <Text type='tertiary' size='small' className='block mt-2'>
                  {t('支持上传 1–6 张图，作为生成的视觉参考')}
                </Text>
              </div>
            )}

            {/* 参数 - 横排 chip 化 */}
            <div className='grid grid-cols-2 gap-3'>
              <div>
                <Text size='small' type='tertiary'>{t('比例')}</Text>
                <Select
                  className='!w-full mt-1'
                  value={size}
                  onChange={setSize}
                  optionList={ASPECT_OPTIONS}
                />
              </div>
              <div>
                <Text size='small' type='tertiary'>{t('数量')}</Text>
                <InputNumber
                  className='!w-full mt-1'
                  min={1}
                  max={4}
                  step={1}
                  value={n}
                  onChange={(v) => setN(Number(v) || 1)}
                />
              </div>
            </div>

            {/* 费用预估 */}
            <div className='flex items-center justify-between rounded-xl px-3 py-2 bg-gradient-to-r from-amber-50 to-rose-50 dark:from-amber-900/20 dark:to-rose-900/20 border border-amber-200/60 dark:border-amber-800/40'>
              <div className='flex items-center gap-2'>
                <span className='text-amber-600 dark:text-amber-300'>💰</span>
                <Text size='small' type='secondary'>
                  {t('预计本次消耗')}
                </Text>
              </div>
              <Tooltip
                content={
                  estimatedQuota != null
                    ? t(
                        '基于 模型价 × 分组倍率({{gr}}) × 尺寸系数({{sr}}) × 张数({{n}}) 估算，实际以上游返回为准',
                        {
                          gr: (groupRatioMap[group] ?? 1).toString(),
                          sr: computeSizeRatio(model, size).toString(),
                          n,
                        },
                      )
                    : t('暂无该模型价格信息，将按上游实际用量结算')
                }
              >
                <Text strong style={{ color: estimatedQuota != null ? '#e11d48' : undefined }}>
                  {estimatedQuota != null
                    ? `≈ ${renderQuota(estimatedQuota, 4)}`
                    : t('未知')}
                </Text>
              </Tooltip>
            </div>

            {/* CTA */}
            <Button
              theme='solid'
              size='large'
              block
              loading={loading}
              disabled={!canGenerate}
              onClick={handleGenerate}
              icon={<IconBolt />}
              className='!h-12 !rounded-xl !text-base !font-semibold !bg-gradient-to-r !from-indigo-500 !via-purple-500 !to-pink-500 hover:!opacity-90'
            >
              {loading ? t('生成中…') : t('生成图像')}
            </Button>

            <Text type='tertiary' size='small' className='leading-relaxed'>
              {t('计费按上游模型实际用量结算，分组倍率会影响最终扣费。')}
            </Text>
          </div>
        </div>

        {/* 画廊 */}
        <div className='rounded-2xl border border-semi-color-border bg-semi-color-bg-1 shadow-sm min-h-[60vh] p-4'>
          {loading && results.length === 0 ? (
            <div className='flex flex-col items-center justify-center py-32 gap-4'>
              <Spin size='large' />
              <Text type='tertiary'>{t('正在生成，请稍候…')}</Text>
              <div className='flex gap-1.5'>
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className='w-2 h-2 rounded-full bg-gradient-to-r from-indigo-500 to-pink-500 animate-pulse'
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
          ) : results.length === 0 ? (
            <div className='flex items-center justify-center py-24'>
              <Empty
                image={
                  <div className='w-24 h-24 rounded-3xl bg-gradient-to-br from-indigo-100 via-purple-100 to-pink-100 dark:from-indigo-900/40 dark:via-purple-900/40 dark:to-pink-900/40 flex items-center justify-center'>
                    <IconImage size='extra-large' className='text-purple-500' />
                  </div>
                }
                title={
                  <span className='text-base font-medium'>{t('开启你的创作')}</span>
                }
                description={t('在左侧写下提示词，点击「生成图像」开始')}
              />
            </div>
          ) : (
            <div className='grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'>
              {results.map((it) => (
                <div
                  key={it.id}
                  className='group relative rounded-xl overflow-hidden bg-semi-color-bg-2 border border-semi-color-border hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200'
                >
                  <div className='relative aspect-square bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900'>
                    <Image
                      src={it.src}
                      width='100%'
                      height='100%'
                      style={{ objectFit: 'cover' }}
                      preview
                    />
                    {/* hover 工具条 */}
                    <div className='absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity'>
                      <Tooltip content={t('用作参考图（图生图）')}>
                        <Button
                          size='small'
                          icon={<IconImage />}
                          onClick={() => useAsReference(it)}
                          className='!backdrop-blur !bg-white/70 dark:!bg-black/50'
                        />
                      </Tooltip>
                      <Tooltip content={t('复用提示词')}>
                        <Button
                          size='small'
                          icon={<IconCopy />}
                          onClick={() => reusePrompt(it)}
                          className='!backdrop-blur !bg-white/70 dark:!bg-black/50'
                        />
                      </Tooltip>
                      <Tooltip content={t('下载')}>
                        <Button
                          size='small'
                          icon={<IconDownload />}
                          onClick={() => downloadOne(it)}
                          className='!backdrop-blur !bg-white/70 dark:!bg-black/50'
                        />
                      </Tooltip>
                      <Tooltip content={t('移除')}>
                        <Button
                          size='small'
                          icon={<IconClose />}
                          onClick={() => removeOne(it.id)}
                          className='!backdrop-blur !bg-white/70 dark:!bg-black/50'
                        />
                      </Tooltip>
                    </div>
                  </div>
                  <div className='p-3'>
                    <Text
                      ellipsis={{ showTooltip: true, rows: 2 }}
                      className='!text-[13px] !leading-snug'
                    >
                      {it.prompt}
                    </Text>
                    <div className='flex items-center gap-1 mt-2 flex-wrap'>
                      <Tag size='small' color='blue' type='light'>{it.model}</Tag>
                      <Tag size='small' color='grey' type='light'>{it.size}</Tag>
                      {it.mode === 'i2i' && (
                        <Tag size='small' color='purple' type='light'>i2i</Tag>
                      )}
                      {it.cost != null ? (
                        <Tooltip
                          content={
                            it.batchSize > 1
                              ? t('本次共 {{n}} 张，合计 {{c}}', {
                                  n: it.batchSize,
                                  c: renderQuota(it.cost, 4),
                                })
                              : t('本次消耗 {{c}}', {
                                  c: renderQuota(it.cost, 4),
                                })
                          }
                        >
                          <Tag size='small' color='red' type='light'>
                            {renderQuota(
                              it.batchSize > 1 ? it.cost / it.batchSize : it.cost,
                              4,
                            )}
                          </Tag>
                        </Tooltip>
                      ) : (
                        <Tag size='small' color='grey' type='ghost'>
                          {t('计费中…')}
                        </Tag>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImageStudio;
