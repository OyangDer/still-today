using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace StillToday;

// Windows Credential Manager. The Canvas token and calendar feed links are bearer secrets: they
// live only here and in the request that uses them, never in data.json and never in the page.
internal static class Secrets
{
    private const uint Generic = 1;
    private const uint PersistLocalMachine = 2;
    private const int ErrorNotFound = 1168;

    public static string Read(string target) => Read(target, out _);

    public static string Read(string target, out string userName)
    {
        userName = null;
        if (!Native.CredRead(target, Generic, 0, out var handle))
        {
            var error = Marshal.GetLastWin32Error();
            if (error == ErrorNotFound) return null;
            throw new Win32Exception(error);
        }
        try
        {
            var credential = Marshal.PtrToStructure<Native.CREDENTIAL>(handle);
            var bytes = new byte[credential.CredentialBlobSize];
            if (bytes.Length > 0) Marshal.Copy(credential.CredentialBlob, bytes, 0, bytes.Length);
            userName = credential.UserName;
            return Encoding.Unicode.GetString(bytes);
        }
        finally
        {
            Native.CredFree(handle);
        }
    }

    public static void Write(string target, string userName, string secret)
    {
        var blob = Encoding.Unicode.GetBytes(secret);
        var credential = new Native.CREDENTIAL
        {
            Type = Generic,
            TargetName = target,
            UserName = userName,
            Persist = PersistLocalMachine,
            CredentialBlobSize = (uint)blob.Length,
            CredentialBlob = Marshal.AllocHGlobal(blob.Length),
        };
        try
        {
            Marshal.Copy(blob, 0, credential.CredentialBlob, blob.Length);
            if (!Native.CredWrite(ref credential, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        finally
        {
            Marshal.FreeHGlobal(credential.CredentialBlob);
        }
    }

    public static void Delete(string target) => Native.CredDelete(target, Generic, 0);
}
