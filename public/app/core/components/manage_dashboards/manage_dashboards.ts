import { IScope } from 'angular';
import _ from 'lodash';
import { SelectableValue } from '@grafana/data';
import coreModule from 'app/core/core_module';
import appEvents from 'app/core/app_events';
import { SearchSrv } from 'app/core/services/search_srv';
import { backendSrv } from 'app/core/services/backend_srv';
import { ContextSrv } from 'app/core/services/context_srv';
import { CoreEvents } from 'app/types';
import { promiseToDigest } from '../../utils/promiseToDigest';

export interface Section {
  id: number;
  uid: string;
  title: string;
  expanded: boolean;
  removable: boolean;
  items: any[];
  url: string;
  icon: string;
  score: number;
  checked: boolean;
  hideHeader: boolean;
  toggle: Function;
  type?: string;
}

export interface FoldersAndDashboardUids {
  folderUids: string[];
  dashboardUids: string[];
}

class Query {
  query: string;
  mode: string;
  tag: any[];
  starred: boolean;
  skipRecent: boolean;
  skipStarred: boolean;
  folderIds: number[];
}

export class ManageDashboardsCtrl {
  sections: Section[];

  query: Query;
  navModel: any;

  selectAllChecked = false;

  // enable/disable actions depending on the folders or dashboards selected
  canDelete = false;
  canMove = false;

  // filter variables
  hasFilters = false;
  tagFilterOptions: any[];
  selectedTagFilter: any;
  selectedStarredFilter: any;

  // used when managing dashboards for a specific folder
  folderId?: number;
  folderUid?: string;

  // if user can add new folders and/or add new dashboards
  canSave = false;

  // if user has editor role or higher
  isEditor: boolean;

  hasEditPermissionInFolders: boolean;

  /** @ngInject */
  constructor(private $scope: IScope, private searchSrv: SearchSrv, private contextSrv: ContextSrv) {
    this.isEditor = this.contextSrv.isEditor;
    this.hasEditPermissionInFolders = this.contextSrv.hasEditPermissionInFolders;

    this.query = {
      query: '',
      mode: 'tree',
      tag: [],
      starred: false,
      skipRecent: true,
      skipStarred: true,
      folderIds: [],
    };

    if (this.folderId) {
      this.query.folderIds = [this.folderId];
    }

    this.refreshList().then(() => {
      this.initTagFilter();
    });
  }

  refreshList() {
    return this.searchSrv
      .search(this.query)
      .then((result: Section[]) => {
        return this.initDashboardList(result);
      })
      .then(() => {
        if (!this.folderUid) {
          this.$scope.$digest();
          return undefined;
        }

        return backendSrv.getFolderByUid(this.folderUid).then((folder: any) => {
          this.canSave = folder.canSave;
          if (!this.canSave) {
            this.hasEditPermissionInFolders = false;
          }
          this.$scope.$digest();
        });
      });
  }

  initDashboardList(result: Section[]) {
    this.canMove = false;
    this.canDelete = false;
    this.selectAllChecked = false;
    this.hasFilters = this.query.query.length > 0 || this.query.tag.length > 0 || this.query.starred;

    if (!result) {
      this.sections = [];
      return;
    }

    this.sections = result;

    for (const section of this.sections) {
      section.checked = false;

      for (const dashboard of section.items) {
        dashboard.checked = false;
      }
    }

    if (this.folderId && this.sections.length > 0) {
      this.sections[0].hideHeader = true;
    }
  }

  selectionChanged = () => {
    let selectedDashboards = 0;

    if (this.sections) {
      for (const section of this.sections) {
        selectedDashboards += _.filter(section.items, { checked: true } as any).length;
      }

      const selectedFolders = _.filter(this.sections, { checked: true }).length;
      this.canMove = selectedDashboards > 0;
      this.canDelete = selectedDashboards > 0 || selectedFolders > 0;
    }
  };

  getFoldersAndDashboardsToDelete(): FoldersAndDashboardUids {
    const selectedDashboards: FoldersAndDashboardUids = {
      folderUids: [],
      dashboardUids: [],
    };

    for (const section of this.sections) {
      if (section.checked && section.id !== 0) {
        selectedDashboards.folderUids.push(section.uid);
      } else {
        const selected = _.filter(section.items, { checked: true } as any);
        selectedDashboards.dashboardUids.push(..._.map(selected, 'uid'));
      }
    }

    return selectedDashboards;
  }

  getFolderIds(sections: Section[]) {
    const ids = [];
    for (const s of sections) {
      if (s.checked) {
        ids.push(s.id);
      }
    }
    return ids;
  }

  delete = () => {
    const data = this.getFoldersAndDashboardsToDelete();
    const folderCount = data.folderUids.length;
    const dashCount = data.dashboardUids.length;
    let text = 'Do you want to delete the ';
    let text2;

    if (folderCount > 0 && dashCount > 0) {
      text += `selected folder${folderCount === 1 ? '' : 's'} and dashboard${dashCount === 1 ? '' : 's'}?`;
      text2 = `All dashboards of the selected folder${folderCount === 1 ? '' : 's'} will also be deleted`;
    } else if (folderCount > 0) {
      text += `selected folder${folderCount === 1 ? '' : 's'} and all its dashboards?`;
    } else {
      text += `selected dashboard${dashCount === 1 ? '' : 's'}?`;
    }

    appEvents.emit(CoreEvents.showConfirmModal, {
      title: 'Delete',
      text: text,
      text2: text2,
      icon: 'trash-alt',
      yesText: 'Delete',
      onConfirm: () => {
        this.deleteFoldersAndDashboards(data.folderUids, data.dashboardUids);
      },
    });
  };

  private deleteFoldersAndDashboards(folderUids: string[], dashboardUids: string[]) {
    promiseToDigest(this.$scope)(
      backendSrv.deleteFoldersAndDashboards(folderUids, dashboardUids).then(() => {
        this.refreshList();
      })
    );
  }

  getDashboardsToMove() {
    const selectedDashboards = [];

    for (const section of this.sections) {
      const selected = _.filter(section.items, { checked: true } as any);
      selectedDashboards.push(..._.map(selected, 'uid'));
    }

    return selectedDashboards;
  }

  moveTo = () => {
    const selectedDashboards = this.getDashboardsToMove();

    const template =
      '<move-to-folder-modal dismiss="dismiss()" ' +
      'dashboards="model.dashboards" after-save="model.afterSave()">' +
      '</move-to-folder-modal>';
    appEvents.emit(CoreEvents.showModal, {
      templateHtml: template,
      modalClass: 'modal--narrow',
      model: {
        dashboards: selectedDashboards,
        afterSave: this.refreshList.bind(this),
      },
    });
  };

  initTagFilter() {
    return this.searchSrv.getDashboardTags().then((results: any) => {
      this.tagFilterOptions = results.map((result: any) => ({ value: result.term, label: result.term }));
    });
  }

  filterByTag = (tag: any) => {
    if (tag) {
      if (_.indexOf(this.query.tag, tag) === -1) {
        this.query.tag.push(tag);
      }
    }
    return this.refreshList();
  };

  onQueryChange() {
    return this.refreshList();
  }

  onTagFilterChange = (filter: SelectableValue) => {
    const res = this.filterByTag(filter.value);
    this.selectedTagFilter = filter.value;
    return res;
  };

  removeTag(tag: any, evt: Event) {
    this.query.tag = _.without(this.query.tag, tag);
    this.refreshList();
    if (evt) {
      evt.stopPropagation();
      evt.preventDefault();
    }
  }

  removeStarred() {
    this.query.starred = false;
    return this.refreshList();
  }

  onStarredFilterChange = (filter: SelectableValue) => {
    this.query.starred = filter.value;
    this.selectedStarredFilter = filter.value;
    return this.refreshList();
  };

  onSelectAllChanged = () => {
    this.selectAllChecked = !this.selectAllChecked;

    for (const section of this.sections) {
      if (!section.hideHeader) {
        section.checked = this.selectAllChecked;
      }

      section.items = _.map(section.items, (item: any) => {
        item.checked = this.selectAllChecked;
        return item;
      });
    }
    this.selectionChanged();
  };

  clearFilters() {
    this.query.query = '';
    this.query.tag = [];
    this.query.starred = false;
    this.selectedStarredFilter = 'starred';
    this.selectedTagFilter = 'tag';
    this.refreshList();
  }

  createDashboardUrl() {
    let url = 'dashboard/new';

    if (this.folderId) {
      url += `?folderId=${this.folderId}`;
    }

    return url;
  }

  importDashboardUrl() {
    let url = 'dashboard/import';

    if (this.folderId) {
      url += `?folderId=${this.folderId}`;
    }

    return url;
  }

  // TODO handle this inside SearchResults component
  toggleSelection = (item: any, evt: any) => {
    if (evt) {
      evt.stopPropagation();
      evt.preventDefault();
    }

    item.checked = !item.checked;

    if (item.items) {
      _.each(item.items, i => {
        i.checked = item.checked;
      });
    }

    if (this.selectionChanged) {
      this.selectionChanged();
    }
  };
}

export function manageDashboardsDirective() {
  return {
    restrict: 'E',
    templateUrl: 'public/app/core/components/manage_dashboards/manage_dashboards.html',
    controller: ManageDashboardsCtrl,
    bindToController: true,
    controllerAs: 'ctrl',
    scope: {
      folderId: '=',
      folderUid: '=',
    },
  };
}

coreModule.directive('manageDashboards', manageDashboardsDirective);
