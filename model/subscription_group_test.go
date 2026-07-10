package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSubscriptionGroupScopeNormalizationAndMatching(t *testing.T) {
	tests := []struct {
		name       string
		scope      string
		group      string
		normalized string
		allowed    bool
	}{
		{name: "empty means all", group: "default", allowed: true},
		{name: "csv is normalized", scope: " vip,default,vip ", group: "vip", normalized: "default,vip", allowed: true},
		{name: "json legacy format", scope: `["vip","auto"]`, group: "auto", normalized: "auto,vip", allowed: true},
		{name: "unrelated group", scope: "vip", group: "default", normalized: "vip", allowed: false},
		{name: "scoped subscription requires group", scope: "vip", normalized: "vip", allowed: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assert.Equal(t, test.normalized, NormalizeAllowedTokenGroups(test.scope))
			assert.Equal(t, test.allowed, IsSubscriptionGroupAllowed(test.scope, test.group))
		})
	}
}

func TestPreConsumeUserSubscriptionUsesPurchaseScopeAndRequestGroup(t *testing.T) {
	truncateTables(t)
	now := GetDBTimestamp()
	allowOverflow := true
	plan := &SubscriptionPlan{
		Id:                  9701,
		Title:               "VIP",
		DurationUnit:        SubscriptionDurationMonth,
		DurationValue:       1,
		TotalAmount:         100,
		AllowWalletOverflow: &allowOverflow,
		AllowedTokenGroups:  "vip",
	}
	require.NoError(t, DB.Create(plan).Error)
	require.NoError(t, DB.Create(&UserSubscription{
		Id:                  9702,
		UserId:              9703,
		PlanId:              plan.Id,
		AmountTotal:         100,
		StartTime:           now - 60,
		EndTime:             now + 3600,
		Status:              "active",
		AllowWalletOverflow: true,
		AllowedTokenGroups:  "vip",
	}).Error)

	_, err := PreConsumeUserSubscription("scope-default", 9703, "gpt-image-1", 0, "default", 10)
	require.ErrorContains(t, err, "subscription quota insufficient")

	result, err := PreConsumeUserSubscription("scope-vip", 9703, "gpt-image-1", 0, "vip", 10)
	require.NoError(t, err)
	assert.Equal(t, 9702, result.UserSubscriptionId)
	assert.EqualValues(t, 10, result.AmountUsedAfter)

	replayed, err := PreConsumeUserSubscription("scope-vip", 9703, "gpt-image-1", 0, "vip", 10)
	require.NoError(t, err)
	assert.Equal(t, result.UserSubscriptionId, replayed.UserSubscriptionId)

	_, err = PreConsumeUserSubscription("scope-vip", 9703, "gpt-image-1", 0, "default", 10)
	require.ErrorContains(t, err, "request group mismatch")
}

func TestWalletOverflowOnlyConsidersMatchingSubscriptions(t *testing.T) {
	truncateTables(t)
	now := GetDBTimestamp()
	require.NoError(t, DB.Create(&UserSubscription{
		Id:                  9801,
		UserId:              9802,
		PlanId:              1,
		EndTime:             now + 3600,
		Status:              "active",
		AllowWalletOverflow: false,
		AllowedTokenGroups:  "vip",
	}).Error)

	allowed, err := UserActiveSubscriptionsAllowWalletOverflow(9802, "default")
	require.NoError(t, err)
	assert.True(t, allowed)

	allowed, err = UserActiveSubscriptionsAllowWalletOverflow(9802, "vip")
	require.NoError(t, err)
	assert.False(t, allowed)
}

func TestGroupSubscriptionMigrationBackfillsLegacySnapshotsOnce(t *testing.T) {
	truncateTables(t)
	legacyDefault := true
	require.NoError(t, DB.Create(&SubscriptionPlan{
		Id:                    9901,
		Title:                 "Legacy VIP",
		DurationUnit:          SubscriptionDurationMonth,
		DurationValue:         1,
		AllowedTokenGroups:    "vip",
		DisableWalletFallback: true,
		AllowWalletOverflow:   &legacyDefault,
	}).Error)
	require.NoError(t, DB.Create(&UserSubscription{Id: 9902, UserId: 9903, PlanId: 9901}).Error)

	err := migrateGroupSubscriptionSnapshots(groupSubscriptionMigrationState{
		planHadLegacyFallback: true,
	})
	require.NoError(t, err)

	var plan SubscriptionPlan
	require.NoError(t, DB.First(&plan, 9901).Error)
	require.NotNil(t, plan.AllowWalletOverflow)
	assert.False(t, *plan.AllowWalletOverflow)
	var subscription UserSubscription
	require.NoError(t, DB.First(&subscription, 9902).Error)
	assert.Equal(t, "vip", subscription.AllowedTokenGroups)
	assert.False(t, subscription.AllowWalletOverflow)

	// The marker prevents later plan edits from mutating purchase snapshots.
	require.NoError(t, DB.Model(&SubscriptionPlan{}).Where("id = ?", 9901).Update("allowed_token_groups", "default").Error)
	require.NoError(t, migrateGroupSubscriptionSnapshots(groupSubscriptionMigrationState{}))
	require.NoError(t, DB.First(&subscription, 9902).Error)
	assert.Equal(t, "vip", subscription.AllowedTokenGroups)

	var marker Option
	require.NoError(t, DB.Where("key = ?", "MigrationGroupSubscriptionsV1").First(&marker).Error)
	assert.Equal(t, "done", marker.Value)
}
