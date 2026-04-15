package setting

import (
	"encoding/json"
	"fmt"
	"sync"

	"github.com/QuantumNous/new-api/common"
)

var userUsableGroups = map[string]string{
	"default": "默认分组",
	"vip":     "vip分组",
}
var userUsableGroupsMutex sync.RWMutex

type userUsableGroupsJSON map[string]interface{}

func (g userUsableGroupsJSON) normalize() (map[string]string, error) {
	normalized := make(map[string]string, len(g))
	for key, value := range g {
		switch typed := value.(type) {
		case string:
			normalized[key] = typed
		case float64:
			normalized[key] = common.Interface2String(typed)
		case bool:
			normalized[key] = common.Interface2String(typed)
		case nil:
			normalized[key] = ""
		default:
			return nil, fmt.Errorf("invalid user usable group value type for %s", key)
		}
	}
	return normalized, nil
}

func GetUserUsableGroupsCopy() map[string]string {
	userUsableGroupsMutex.RLock()
	defer userUsableGroupsMutex.RUnlock()

	copyUserUsableGroups := make(map[string]string)
	for k, v := range userUsableGroups {
		copyUserUsableGroups[k] = v
	}
	return copyUserUsableGroups
}

func UserUsableGroups2JSONString() string {
	userUsableGroupsMutex.RLock()
	defer userUsableGroupsMutex.RUnlock()

	jsonBytes, err := json.Marshal(userUsableGroups)
	if err != nil {
		common.SysLog("error marshalling user groups: " + err.Error())
	}
	return string(jsonBytes)
}

func UpdateUserUsableGroupsByJSONString(jsonStr string) error {
	userUsableGroupsMutex.Lock()
	defer userUsableGroupsMutex.Unlock()

	parsed := make(userUsableGroupsJSON)
	if err := json.Unmarshal([]byte(jsonStr), &parsed); err != nil {
		return err
	}
	normalized, err := parsed.normalize()
	if err != nil {
		return err
	}
	userUsableGroups = normalized
	return nil
}

func GetUsableGroupDescription(groupName string) string {
	userUsableGroupsMutex.RLock()
	defer userUsableGroupsMutex.RUnlock()

	if desc, ok := userUsableGroups[groupName]; ok {
		return desc
	}
	return groupName
}
