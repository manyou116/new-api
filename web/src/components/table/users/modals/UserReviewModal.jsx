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
  Spin,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import {
  API,
  renderNumber,
  renderQuota,
  showError,
  timestamp2string,
} from '../../../../helpers';

const { Text, Paragraph } = Typography;

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
  const [reviewSummary, setReviewSummary] = useState(null);

  useEffect(() => {
    if (!visible) {
      setReviewSummary(null);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || !user?.id) {
      return;
    }

    let disposed = false;

    const loadReviewSummary = async () => {
      setDetailLoading(true);
      try {
        const res = await API.get(`/api/user/${user.id}/review`);
        const { success, message, data } = res.data;
        if (!success) {
          showError(message || t('加载用户审阅数据失败'));
          return;
        }
        if (!disposed) {
          setReviewSummary(data || null);
        }
      } catch (error) {
        if (!disposed) {
          showError(t('加载用户审阅数据失败'));
        }
      } finally {
        if (!disposed) {
          setDetailLoading(false);
        }
      }
    };

    loadReviewSummary().catch(() => {});

    return () => {
      disposed = true;
    };
  }, [visible, user?.id, t]);

  const reviewUser = reviewSummary?.user || user;
  const statusMeta = getUserStatusMeta(reviewUser, t);
  const roleMeta = getRoleMeta(reviewUser?.role, t);
  const subscriptions = Array.isArray(reviewSummary?.subscriptions)
    ? reviewSummary.subscriptions
    : [];
  const security = reviewSummary?.security || {};
  const usage = reviewSummary?.usage || {};

  const bindingRows = useMemo(() => {
    const rows = [
      { key: t('邮箱'), value: reviewUser?.email || '' },
      { key: t('GitHub'), value: reviewUser?.github_id || '' },
      { key: t('微信'), value: reviewUser?.wechat_id || '' },
      { key: t('Telegram'), value: reviewUser?.telegram_id || '' },
      { key: t('OIDC'), value: reviewUser?.oidc_id || '' },
      { key: t('Discord'), value: reviewUser?.discord_id || '' },
      { key: t('Linux DO'), value: reviewUser?.linux_do_id || '' },
      { key: t('妖火'), value: reviewUser?.yaohuo_id || '' },
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
    {
      key: t('最近活跃'),
      value: reviewSummary?.is_recently_active ? t('是') : t('否'),
    },
  ];

  const commercialRows = [
    {
      key: t('剩余额度'),
      value: renderQuota(reviewUser?.quota || 0),
    },
    {
      key: t('已用额度'),
      value: renderQuota(usage.used_quota || reviewUser?.used_quota || 0),
    },
    {
      key: t('调用次数'),
      value: renderNumber(usage.request_count || reviewUser?.request_count || 0),
    },
    {
      key: t('订阅状态'),
      value: reviewSummary?.has_subscription ? t('已订阅') : t('无订阅'),
    },
    {
      key: t('当前订阅计划'),
      value: reviewSummary?.subscription_plan || '-',
    },
    {
      key: t('邀请收益'),
      value: renderQuota(reviewUser?.aff_history_quota || 0),
    },
  ];

  const relationRows = [
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
    {
      key: t('累计返佣额度'),
      value: renderQuota(reviewUser?.aff_history_quota || 0),
    },
  ];

  const activityRows = [
    {
      key: t('调用次数'),
      value: renderNumber(usage.request_count || reviewUser?.request_count || 0),
    },
    {
      key: t('已用额度'),
      value: renderQuota(usage.used_quota || reviewUser?.used_quota || 0),
    },
    {
      key: t('最近请求'),
      value: formatMaybeTimestamp(usage.last_request_at || reviewUser?.last_request_at, t),
    },
    {
      key: t('最后活跃时间'),
      value: formatMaybeTimestamp(reviewSummary?.last_activity_at, t),
    },
    {
      key: t('最近活跃窗口'),
      value: reviewSummary?.recently_active_days
        ? t('近 {{days}} 天', { days: reviewSummary.recently_active_days })
        : '-',
    },
  ];

  const securityRows = [
    {
      key: '2FA',
      value:
        reviewSummary?.has_two_fa || security.has_2fa ? t('已启用') : t('未启用'),
    },
    {
      key: 'Passkey',
      value:
        reviewSummary?.has_passkey || security.has_passkey
          ? t('已启用')
          : t('未启用'),
    },
    {
      key: t('绑定数量'),
      value: renderNumber(reviewSummary?.binding_count || security.binding_count || 0),
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
      <Spin spinning={detailLoading}>
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

            <ReviewSection title={t('商业信息')}>
              <Descriptions data={commercialRows} column={1} />
              {subscriptions.length > 0 ? (
                <div className='mt-3 flex flex-wrap gap-2'>
                  {subscriptions.map((subscription, index) => (
                    <Tag
                      key={`${subscription.id || subscription.subscription_id || index}`}
                      color='green'
                      shape='circle'
                    >
                      {subscription.plan_title || subscription.subscription_plan || t('订阅计划')}
                    </Tag>
                  ))}
                </div>
              ) : null}
            </ReviewSection>
          </div>

          <div className='grid grid-cols-1 lg:grid-cols-2 gap-4'>
            <ReviewSection title={t('订阅与绑定信息')}>
              <Descriptions data={relationRows} column={1} />
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

            <ReviewSection title={t('活跃与使用')}>
              <Descriptions data={activityRows} column={1} />
            </ReviewSection>
          </div>

          <div className='grid grid-cols-1 lg:grid-cols-2 gap-4'>
            <ReviewSection title={t('安全信息')}>
              <Descriptions data={securityRows} column={1} />
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
