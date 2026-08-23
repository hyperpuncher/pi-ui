using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

internal static class Program
{
	private const uint FOS_PICKFOLDERS = 0x20;
	private const uint FOS_FORCEFILESYSTEM = 0x40;
	private const uint FOS_PATHMUSTEXIST = 0x800;
	private const uint SIGDN_FILESYSPATH = 0x80058000;
	private const int ERROR_CANCELLED = unchecked((int)0x800704C7);

	[ComImport]
	[Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
	[ClassInterface(ClassInterfaceType.None)]
	private class FileOpenDialog { }

	[ComImport]
	[Guid("D57C7288-D4AD-4768-BE02-9D969532D960")]
	[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	private interface IFileOpenDialog
	{
		[PreserveSig] int Show(IntPtr parent);
		void SetFileTypes(uint count, IntPtr filterSpec);
		void SetFileTypeIndex(uint index);
		void GetFileTypeIndex(out uint index);
		void Advise(IntPtr events, out uint cookie);
		void Unadvise(uint cookie);
		void SetOptions(uint options);
		void GetOptions(out uint options);
		void SetDefaultFolder(IShellItem item);
		void SetFolder(IShellItem item);
		void GetFolder(out IShellItem item);
		void GetCurrentSelection(out IShellItem item);
		void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
		void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
		void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
		void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
		void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
		void GetResult(out IShellItem item);
		void AddPlace(IShellItem item, int placement);
		void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string extension);
		void Close(int result);
		void SetClientGuid(ref Guid guid);
		void ClearClientData();
		void SetFilter(IntPtr filter);
		void GetResults(out IntPtr items);
		void GetSelectedItems(out IntPtr items);
	}

	[ComImport]
	[Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
	[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	private interface IShellItem
	{
		void BindToHandler(IntPtr context, ref Guid handler, ref Guid iid, out IntPtr result);
		void GetParent(out IShellItem parent);
		void GetDisplayName(uint nameType, out IntPtr name);
		void GetAttributes(uint mask, out uint attributes);
		void Compare(IShellItem item, uint hint, out int order);
	}

	[STAThread]
	private static int Main(string[] args)
	{
		IFileOpenDialog dialog = (IFileOpenDialog)new FileOpenDialog();
		IShellItem item = null;
		IntPtr path = IntPtr.Zero;
		try
		{
			uint options;
			dialog.GetOptions(out options);
			dialog.SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);
			dialog.SetTitle("Select workspace");

			IntPtr owner = IntPtr.Zero;
			int ownerProcessId;
			if (args.Length > 0 && int.TryParse(args[0], out ownerProcessId))
			{
				try { owner = Process.GetProcessById(ownerProcessId).MainWindowHandle; }
				catch (ArgumentException) { }
			}

			int result = dialog.Show(owner);
			if (result == ERROR_CANCELLED) return 1;
			Marshal.ThrowExceptionForHR(result);
			dialog.GetResult(out item);
			item.GetDisplayName(SIGDN_FILESYSPATH, out path);
			Console.OutputEncoding = Encoding.UTF8;
			Console.Write(Marshal.PtrToStringUni(path));
			return 0;
		}
		finally
		{
			if (path != IntPtr.Zero) Marshal.FreeCoTaskMem(path);
			if (item != null) Marshal.ReleaseComObject(item);
			Marshal.ReleaseComObject(dialog);
		}
	}
}
