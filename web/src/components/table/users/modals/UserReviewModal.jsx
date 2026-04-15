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

import React, { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Descriptions,
  Modal,
  Select,
  Spin,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import {
  API,
  getLogOther,
  renderNumber,
  renderQuota,
  showError,
  timestamp2string,
} from '../../../../helpers';

const { Text, Paragraph } = Typography;

const LOG_TYPE_OPTIONS = [
  { value: 0, labelKey: '全部日志' },
  { value: 2, labelKey: '消费日志' },
  { value: 5, labelKey: '错误日志' },
];

const TIME_RANGE_OPTIONS = [
  { value: 'today', labelKey: '今日' },
  { value: '7d', labelKey: '近 7 天' },
  { value: '30d', labelKey: '近 30 天' },
];

const getRangeTimestamps = (rangeKey) => {
  const now = Math.floor(Date.now() / 1000);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  if (rangeKey === 'today') {
    return {
      start: Math.floor(startOfToday.getTime() / 1000),
      end: now,
    };
  }

  const days = rangeKey === '30d' ? 30 : 7;
  return {
    start: now - days * 86400,
    end: now,
  };
};

const getUserStatusMeta = (user, t) => {
  if (!user) {
    return { text: '-', color: 'grey' };
  }
  if (user.DeletedAt !== null) {
    return { text: t('已注销'), color: 'red' };
  }
  if (user.status === 1) {
    return { text: t('已启用'), color: 'green' };
  }
  if (user.status === 2) {
    return { text: t('已禁用'), color: 'red' };
  }
  return { text: t('未知状态'), color: 'grey' };
};

const getRoleMeta = (role, t) => {
  if (role === 100) {
    return { text: t('超级管理员'), color: 'orange' };
  }
  if (role === 10) {
    return { text: t('管理员'), color: 'yellow' };
  }
  if (role === 1) {
    return { text: t('普通用户'), color: 'blue' };
  }
  return { text: t('未知身份'), color: 'grey' };
};

const formatMaybeTimestamp = (timestamp, t) => {
  const value = Number(timestamp || 0);
  if (value <= 0) {
    return t('未记录');
  }
  return timestamp2string(value);
};

const ReviewSection = ({ title, children, extra = null }) => (
  <Card className='!rounded-xl'>
    <div className='flex items-center justify-between gap-3 mb-3'>
      <Text strong>{title}</Text>
      {extra}
    </div>
    {children}
  </Card>
);

const UserReviewModal = ({ visible, onCancel, user, t }) => {
  const [detailLoading, setDetailLoading] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [userDetail, setUserDetail] = useState(null);
  const [recentLogs, setRecentLogs] = useState([]);
  const [stat, setStat] = useState({ quota: 0, rpm: 0, tpm: 0 });
  const [timeRange, setTimeRange] = useState('7d');
  const [logType, setLogType] = useState(2);

  useEffect(() => {
    if (!visible) {
      setUserDetail(null);
      setRecentLogs([]);
      setStat({ quota: 0, rpm: 0, tpm: 0 });
      setTimeRange('7d');
      setLogType(2);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    if (!user?.id || !user?.username) {
      return;
    }

    let disposed = false;

    const loadUserDetail = async () => {
      setDetailLoading(true);
      try {
        const res = await API.get(`/api/user/${user.id}`);
        const { success, message, data } = res.data;
        if (!success) {
          showError(message || t('加载用户信息失败'));
          return;
        }
        if (!disposed) {
          setUserDetail(data);
        }
      } catch (error) {
        if (!disposed) {
          showError(t('加载用户信息失败'));
        }
      } finally {
        if (!disposed) {
          setDetailLoading(false);
        }
      }
    };

    loadUserDetail().catch(() => {});

    return () => {
      disposed = true;
    };
  }, [visible, user?.id, user?.username, t]);

  useEffect(() => {
    if (!visible || !user?.username) {
      return;
    }

    let disposed = false;
    const { start, end } = getRangeTimestamps(timeRange);

    const loadLogsAndStats = async () => {
      setLogsLoading(true);
      setStatsLoading(true);
      try {
        const logsUrl = encodeURI(
          `/api/log/?p=0&page_size=10&type=${logType}&username=${user.username}&start_timestamp=${start}&end_timestamp=${end}`,
        );
        const statUrl = encodeURI(
          `/api/log/stat?type=${logType}&username=${user.username}&start_timestamp=${start}&end_timestamp=${end}&channel=0&group=`,
        );

        const [logsRes, statRes] = await Promise.all([
          API.get(logsUrl),
          API.get(statUrl),
        ]);

        if (!disposed) {
          const logsPayload = logsRes?.data || {};
          if (logsPayload.success) {
            setRecentLogs(Array.isArray(logsPayload.data?.items) ? logsPayload.data.items : []);
          } else {
            setRecentLogs([]);
            showError(logsPayload.message || t('加载最近使用记录失败'));
          }

          const statPayload = statRes?.data || {};
          if (statPayload.success) {
            setStat(statPayload.data || { quota: 0, rpm: 0, tpm: 0 });
          } else {
            setStat({ quota: 0, rpm: 0, tpm: 0 });
            showError(statPayload.message || t('加载使用概览失败'));
          }
        }
      } catch (error) {
        if (!disposed) {
          setRecentLogs([]);
          setStat({ quota: 0, rpm: 0, tpm: 0 });
          showError(t('加载用户审阅数据失败'));
        }
      } finally {
        if (!disposed) {
          setLogsLoading(false);
          setStatsLoading(false);
        }
      }
    };

    loadLogsAndStats().catch(() => {});

    return () => {
      disposed = true;
    };
  }, [visible, user?.username, timeRange, logType, t]);

  const reviewUser = userDetail || user;
  const statusMeta = getUserStatusMeta(reviewUser, t);
  const roleMeta = getRoleMeta(reviewUser?.role, t);

  const modelSummary = useMemo(() => {
    const counter = new Map();
    recentLogs.forEach((log) => {
      const name = log?.model_name || t('未知模型');
      const entry = counter.get(name) || { count: 0, quota: 0, lastUsedAt: 0 };
      entry.count += 1;
      entry.quota += Number(log?.quota || 0);
      entry.lastUsedAt = Math.max(entry.lastUsedAt, Number(log?.created_at || 0));
      counter.set(name, entry);
    });

    return Array.from(counter.entries())
      .map(([model, info]) => ({ model, ...info }))
      .sort((a, b) => {
        if (b.count !== a.count) {
          return b.count - a.count;
        }
        return b.lastUsedAt - a.lastUsedAt;
      })
      .slice(0, 5);
  }, [recentLogs, t]);

  const bindingRows = useMemo(() => {
    const rows = [
      { key: t('GitHub'), value: reviewUser?.github_id || '' },
      { key: t('微信'), value: reviewUser?.wechat_id || '' },
      { key: t('Telegram'), value: reviewUser?.telegram_id || '' },
      { key: t('OIDC'), value: reviewUser?.oidc_id || '' },
      { key: t('Discord'), value: reviewUser?.discord_id || '' },
      { key: t('Lark'), value: reviewUser?.lark_id || '' },
      { key: t('钉钉'), value: reviewUser?.dingtalk_id || '' },
      { key: t('飞书'), value: reviewUser?.feishu_id || '' },
    ];
    return rows.filter((item) => item.value);
  }, [reviewUser, t]);

  const overviewRows = [
    {
      key: t('状态'),
      value: <Tag color={statusMeta.color} shape='circle'>{statusMeta.text}</Tag>,
    },
    {
      key: t('角色'),
      value: <Tag color={roleMeta.color} shape='circle'>{roleMeta.text}</Tag>,
    },
    {
      key: t('分组'),
      value: reviewUser?.group || '-',
    },
    {
      key: t('显示名称'),
      value: reviewUser?.display_name || '-',
    },
    {
      key: t('注册时间'),
      value: formatMaybeTimestamp(reviewUser?.created_at, t),
    },
    {
      key: t('最近登录'),
      value: formatMaybeTimestamp(reviewUser?.last_login_at, t),
    },
    {
      key: t('最近请求'),
      value: formatMaybeTimestamp(reviewUser?.last_request_at, t),
    },
  ];

  const quotaRows = [
    {
      key: t('剩余额度'),
      value: renderQuota(reviewUser?.quota || 0),
    },
    {
      key: t('已用额度'),
      value: renderQuota(reviewUser?.used_quota || 0),
    },
    {
      key: t('调用次数'),
      value: renderNumber(reviewUser?.request_count || 0),
    },
    {
      key: t('邀请收益'),
      value: renderQuota(reviewUser?.aff_history_quota || 0),
    },
  ];

  const usageRows = [
    {
      key: t('总消费'),
      value: renderQuota(stat?.quota || 0),
    },
    {
      key: 'RPM',
      value: renderNumber(stat?.rpm || 0),
    },
    {
      key: 'TPM',
      value: renderNumber(stat?.tpm || 0),
    },
    {
      key: t('日志类型'),
      value: t(
        LOG_TYPE_OPTIONS.find((item) => item.value === logType)?.labelKey || '-',
      ),
    },
  ];

  return (
    <Modal
      centered
      visible={visible}
      onCancel={onCancel}
      footer={null}
      width={960}
      title={
        <div className='flex items-center gap-2'>
          <Badge dot type='primary' />
          {t('审阅用户')} {reviewUser?.username || ''}
        </div>
      }
    >
      <Spin spinning={detailLoading || logsLoading || statsLoading}>
        <div className='max-h-[72vh] overflow-y-auto pr-1 pb-2 space-y-4'>

          <div className='grid grid-cols-1 lg:grid-cols-2 gap-4'>
            <ReviewSection title={t('账号概览')}>
              <Descriptions data={overviewRows} column={1} />
              {reviewUser?.remark ? (
                <div className='mt-3'>
                  <Text type='tertiary' size='small'>
                    {t('备注')}
                  </Text>
                  <Paragraph className='!mb-0 mt-1 break-all'>
                    {reviewUser.remark}
                  </Paragraph>
                </div>
              ) : null}
            </ReviewSection>

            <ReviewSection title={t('额度概览')}>
              <Descriptions data={quotaRows} column={1} />
            </ReviewSection>
          </div>

          <div className='grid grid-cols-1 lg:grid-cols-2 gap-4'>
            <ReviewSection title={t('邀请与绑定信息')}>
              <Descriptions
                data={[
                  {
                    key: t('邀请人 ID'),
                    value: reviewUser?.inviter_id ? reviewUser.inviter_id : t('无邀请人'),
                  },
                  {
                    key: t('邀请码'),
                    value: reviewUser?.aff_code || '-',
                  },
                  {
                    key: t('邀请人数'),
                    value: renderNumber(reviewUser?.aff_count || 0),
                  },
                  {
                    key: t('当前返佣额度'),
                    value: renderQuota(reviewUser?.aff_quota || 0),
                  },
                ]}
                column={1}
              />
              {bindingRows.length > 0 ? (
                <div className='mt-3 flex flex-wrap gap-2'>
                  {bindingRows.map((item) => (
                    <Tag key={item.key} color='white' shape='circle'>
                      {item.key}: {item.value}
                    </Tag>
                  ))}
                </div>
              ) : (
                <Text type='tertiary' size='small'>
                  {t('暂无绑定账号')}
                </Text>
              )}
            </ReviewSection>

            <ReviewSection
              title={t('使用概览')}
              extra={
                <div className='flex gap-2'>
                  <Select
                    size='small'
                    value={timeRange}
                    onChange={setTimeRange}
                    optionList={TIME_RANGE_OPTIONS.map((item) => ({
                      value: item.value,
                      label: t(item.labelKey),
                    }))}
                    style={{ width: 120 }}
                  />
                  <Select
                    size='small'
                    value={logType}
                    onChange={setLogType}
                    optionList={LOG_TYPE_OPTIONS.map((item) => ({
                      value: item.value,
                      label: t(item.labelKey),
                    }))}
                    style={{ width: 120 }}
                  />
                </div>
              }
            >
              <Descriptions data={usageRows} column={1} />
            </ReviewSection>
          </div>

          <div className='grid grid-cols-1 lg:grid-cols-2 gap-4'>
            <ReviewSection title={t('常用模型')}>
              {modelSummary.length > 0 ? (
                <div className='space-y-3'>
                  {modelSummary.map((item) => (
                    <div
                      key={item.model}
                      className='flex items-center justify-between gap-3 rounded-lg bg-semi-color-fill-0 px-3 py-2'
                    >
                      <div className='min-w-0'>
                        <div className='font-medium truncate'>{item.model}</div>
                        <Text type='tertiary' size='small'>
                          {t('最近使用')}: {formatMaybeTimestamp(item.lastUsedAt, t)}
                        </Text>
                      </div>
                      <div className='text-right text-sm'>
                        <div>{t('请求')} {renderNumber(item.count)}</div>
                        <div>{t('消费')} {renderQuota(item.quota)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Text type='tertiary'>{t('当前时间范围内暂无模型使用记录')}</Text>
              )}
            </ReviewSection>

            <ReviewSection title={t('最近使用记录')}>
              {recentLogs.length > 0 ? (
                <div className='space-y-3'>
                  {recentLogs.map((log) => {
                    const other = getLogOther(log.other) || {};
                    const billingSource = other?.billing_source;
                    return (
                      <div
                        key={log.id}
                        className='rounded-lg border border-semi-color-border px-3 py-3'
                      >
                        <div className='flex items-center justify-between gap-3 flex-wrap'>
                          <div className='font-medium break-all'>
                            {log.model_name || t('未知模型')}
                          </div>
                          <div className='flex items-center gap-2 flex-wrap'>
                            {log.group ? (
                              <Tag color='white' shape='circle'>
                                {log.group}
                              </Tag>
                            ) : null}
                            {billingSource === 'subscription' ? (
                              <Tag color='green' shape='circle'>
                                {t('订阅抵扣')}
                              </Tag>
                            ) : null}
                            {log.type === 5 ? (
                              <Tag color='red' shape='circle'>
                                {t('错误')}
                              </Tag>
                            ) : null}
                          </div>
                        </div>
                        <div className='mt-2 text-sm text-semi-color-text-1 flex flex-wrap gap-x-4 gap-y-1'>
                          <span>{t('时间')}: {formatMaybeTimestamp(log.created_at, t)}</span>
                          <span>{t('消费')}: {renderQuota(log.quota || 0)}</span>
                          <span>{t('提示 Tokens')}: {renderNumber(log.prompt_tokens || 0)}</span>
                          <span>{t('补全 Tokens')}: {renderNumber(log.completion_tokens || 0)}</span>
                        </div>
                        {log.request_id ? (
                          <div className='mt-2'>
                            <Text type='tertiary' size='small'>
                              Request ID: {log.request_id}
                            </Text>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <Text type='tertiary'>{t('当前时间范围内暂无使用记录')}</Text>
              )}
            </ReviewSection>
          </div>

          <div className='flex justify-end'>
            <Button onClick={onCancel}>{t('关闭')}</Button>
          </div>
        </div>
      </Spin>
    </Modal>
  );
};

export default UserReviewModal;
