from __future__ import annotations
from typing import Any
from pydantic import BaseModel, Field
from .config import TAG_GROUP_DEFAULT_COLOR

class VaultOpenRequest(BaseModel):
    path: str


class VaultCreateRequest(BaseModel):
    parent_path: str = Field(alias="parentPath")
    name: str


class NoteBaseRenameRequest(BaseModel):
    new_name: str = Field(alias="newName")
    path: str | None = None


class NoteBaseDeleteRequest(BaseModel):
    confirm_delete: bool = Field(default=False, alias="confirmDelete")
    path: str | None = None


class CapturePreviewRequest(BaseModel):
    text: str


class CaptureSaveRequest(BaseModel):
    text: str
    selected_tag_keys: list[str] = Field(default_factory=list, alias="selectedTagKeys")


class FocusMitUpdateRequest(BaseModel):
    date: str | None = None
    mit_ids: list[str] = Field(default_factory=list, alias="mitIds")


class FocusQuickCaptureRequest(BaseModel):
    text: str
    date: str | None = None


class FocusThoughtRequest(BaseModel):
    text: str = Field(max_length=2000)
    task_id: str | None = Field(default=None, alias="taskId", max_length=200)
    date: str | None = None


class FocusSessionLogRequest(BaseModel):
    started_at: str = Field(alias="startedAt", max_length=64)
    ended_at: str = Field(alias="endedAt", max_length=64)
    minutes: int = Field(ge=1, le=600)
    label: str = Field(default="", max_length=500)
    task_id: str | None = Field(default=None, alias="taskId", max_length=200)
    todo_id: str | None = Field(default=None, alias="todoId", max_length=200)
    date: str | None = None


class NoteSaveRequest(BaseModel):
    path: str
    content: str
    expected_revision: str = Field(alias='expectedRevision', min_length=64, max_length=64)


class NoteMediaAddRequest(BaseModel):
    path: str
    file_name: str = Field(alias="fileName")
    content_type: str = Field(default="", alias="contentType")
    data_base64: str = Field(alias="dataBase64")


class TagGroupRequest(BaseModel):
    group_id: str = Field(alias="groupId")
    display_name: str = Field(default="", alias="displayName")
    color: str = Field(default=TAG_GROUP_DEFAULT_COLOR)


class TagCreateRequest(BaseModel):
    group_id: str = Field(alias="groupId")
    tag_id: str = Field(alias="tagId")
    display_name: str = Field(default="", alias="displayName")


class TagRenameRequest(BaseModel):
    group_id: str = Field(alias="groupId")
    tag_id: str = Field(alias="tagId")
    new_tag_id: str = Field(alias="newTagId")
    new_display_name: str = Field(default="", alias="newDisplayName")
    apply_to_notes: bool = Field(default=True, alias="applyToNotes")


class TagGroupRenameRequest(BaseModel):
    group_id: str = Field(alias="groupId")
    new_group_id: str = Field(alias="newGroupId")
    new_display_name: str = Field(default="", alias="newDisplayName")
    new_color: str = Field(default=TAG_GROUP_DEFAULT_COLOR, alias="newColor")
    apply_to_notes: bool = Field(default=True, alias="applyToNotes")


class TagGroupDeleteRequest(BaseModel):
    group_id: str = Field(alias="groupId")
    remove_from_notes: bool = Field(default=False, alias="removeFromNotes")


class TagDeleteRequest(BaseModel):
    group_id: str = Field(alias="groupId")
    tag_id: str = Field(alias="tagId")
    remove_from_notes: bool = Field(default=False, alias="removeFromNotes")


class TagMatchApplyRequest(BaseModel):
    matches: list[dict[str, Any]] = Field(default_factory=list)


class NoteGroupCreateRequest(BaseModel):
    group_name: str = Field(alias="groupName")
    parent_key: str = Field(default="", alias="parentKey")


class NoteCreateRequest(BaseModel):
    group_key: str = Field(alias="groupKey")
    title: str = ""
    note_type: str = Field(default="note", alias="noteType")
    status: str = "open"
    template: str = ""


class TemplateSaveRequest(BaseModel):
    note_path: str = Field(alias="notePath")
    replace: bool = False


class TemplateDeleteRequest(BaseModel):
    name: str


class NoteGroupRenameRequest(BaseModel):
    group_key: str = Field(alias="groupKey")
    new_name: str = Field(alias="newName")


class NoteGroupDeleteRequest(BaseModel):
    group_key: str = Field(alias="groupKey")


class NoteGroupMoveRequest(BaseModel):
    group_key: str = Field(alias="groupKey")
    target_parent_key: str = Field(alias="targetParentKey")


class NoteFileRenameRequest(BaseModel):
    path: str
    new_name: str = Field(alias="newName")


class NoteFileDeleteRequest(BaseModel):
    path: str


class NoteFileMoveRequest(BaseModel):
    path: str
    target_group_key: str = Field(alias="targetGroupKey")


class NoteFileMoveBatchRequest(BaseModel):
    paths: list[str] = Field(default_factory=list)
    target_group_key: str = Field(alias="targetGroupKey")


class FavoriteFolderRequest(BaseModel):
    group_key: str = Field(alias="groupKey")


class UiSettingsUpdateRequest(BaseModel):
    app: dict[str, Any] | None = None
    explorer: dict[str, Any] | None = None


class OneNoteImportPreviewRequest(BaseModel):
    source_paths: list[str] = Field(default_factory=list, alias="sourcePaths")


class OneNoteImportRequest(BaseModel):
    source_paths: list[str] = Field(default_factory=list, alias="sourcePaths")
    target_folder: str = Field(default="", alias="targetFolder")


class TodoToggleRequest(BaseModel):
    checked: bool | None = None


class TaskFollowUpRequest(BaseModel):
    """ISO date from which a task is due for attention again; empty clears it."""
    date: str = ""
