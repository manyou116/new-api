package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

func TestValidateManageUserActionAllowsImplementedActions(t *testing.T) {
	adminRole := common.RoleRootUser
	tests := []struct {
		name string
		user *model.User
	}{
		{"disable", &model.User{Id: 1, Role: common.RoleCommonUser}},
		{"enable", &model.User{Id: 1, Role: common.RoleCommonUser}},
		{"delete", &model.User{Id: 1, Role: common.RoleCommonUser}},
		{"promote", &model.User{Id: 1, Role: common.RoleCommonUser}},
		{"demote", &model.User{Id: 1, Role: common.RoleAdminUser}},
		{"add_quota", &model.User{Id: 1, Role: common.RoleCommonUser}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := validateManageUserAction(adminRole, test.user, test.name); err != nil {
				t.Fatalf("expected action %q to be allowed, got %v", test.name, err)
			}
		})
	}
}
